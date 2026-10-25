const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const APPLICATIONS_FILE = path.join(DATA_DIR, 'applications.json');

const AGREEMENT_FLOW = [
  {
    key: 'fullName',
    label: 'Full name',
    title: 'Applicant Information',
    explanation: 'This section captures the applicant identity so the application can be matched to the correct record.',
    question: 'What is your full legal name?',
    required: true,
  },
  {
    key: 'email',
    label: 'Email',
    title: 'Contact Information',
    explanation: 'This lets the system contact you about application status and any follow-up requirements.',
    question: 'What is your email address?',
    required: true,
  },
  {
    key: 'agreementAcknowledgement',
    label: 'Agreement acknowledgment',
    title: 'Agreement Acknowledgment',
    explanation: 'This confirms you reviewed the agreement and understand that you are agreeing to the terms as written.',
    question: 'Please type: I acknowledge that I have reviewed the agreement and agree to its terms.',
    required: true,
  },
  {
    key: 'signature',
    label: 'Final signature',
    title: 'Final Signature',
    explanation: 'This is the final consent step and must be recorded in the application record before submission.',
    question: 'Please type your full legal name again to sign the agreement.',
    required: true,
  },
];

const FAQ_LIBRARY = [
  {
    keywords: ['what does this mean', 'what am i agreeing to', 'what does this section mean', 'what does this say'],
    reply: 'This section explains the agreement requirement and asks for your answer. It does not change the meaning of the agreement. If you are unsure, answer based on the exact wording and ask Goddess Jade for clarification if needed.',
  },
  {
    keywords: ['can you explain this in simpler terms', 'plain language', 'simpler terms'],
    reply: 'In plain language, this step asks you to confirm that you understand the requirement and are willing to proceed under the agreement as written. It is not a separate agreement and it does not guarantee approval.',
  },
  {
    keywords: ['what if i need to update one of my answers', 'update my answer', 'change my answer'],
    reply: 'You may update your answers before final submission. The system preserves your current progress and stores the latest answer in the same application record.',
  },
  {
    keywords: ['what if i miss a payment deadline', 'payment deadline', 'miss a payment'],
    reply: 'Payment deadlines are part of the approval and verification process. If you are unsure about a specific deadline, ask Goddess Jade directly instead of guessing. Submission does not mean approval or payment verification.',
  },
  {
    keywords: ['what happens if i do not finish', 'not complete', 'unfinished agreement'],
    reply: 'The agreement remains in progress until all required fields are completed and submitted. Incomplete agreements are not treated as final consent.',
  },
  {
    keywords: ['who can answer this', 'who approves', 'can goddess jade clarify'],
    reply: 'If the answer is not covered by the approved FAQ or agreement text, the chatbot should direct you to Goddess Jade for clarification. It should not guess or invent policy.',
  },
];

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(APPLICATIONS_FILE)) {
    fs.writeFileSync(APPLICATIONS_FILE, JSON.stringify([], null, 2));
  }
}

function readApplications() {
  ensureStorage();
  try {
    return JSON.parse(fs.readFileSync(APPLICATIONS_FILE, 'utf8'));
  } catch (error) {
    return [];
  }
}

function writeApplications(applications) {
  ensureStorage();
  fs.writeFileSync(APPLICATIONS_FILE, JSON.stringify(applications, null, 2));
}

function normalizeValue(value) {
  return String(value ?? '').trim();
}

function buildApplication() {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'in_progress',
    currentStep: 0,
    agreementVersion: 'v1',
    answers: {},
    submittedAt: null,
    paymentStatus: 'pending',
    approvalStatus: 'pending',
    accessStatus: 'not_authorized',
    completionSummary: {
      started: true,
      completedSections: [],
    },
  };
}

function getApplicationById(applicationId) {
  const applications = readApplications();
  return applications.find((item) => item.id === applicationId) || null;
}

function saveApplication(application) {
  const applications = readApplications();
  const index = applications.findIndex((item) => item.id === application.id);
  if (index >= 0) {
    applications[index] = application;
  } else {
    applications.push(application);
  }
  writeApplications(applications);
  return application;
}

function getCurrentStep(application) {
  return AGREEMENT_FLOW[application.currentStep] || null;
}

function getProgress(application) {
  const answered = AGREEMENT_FLOW.filter((step) => {
    const value = normalizeValue(application.answers[step.key]);
    return value.length > 0;
  }).length;

  return {
    total: AGREEMENT_FLOW.length,
    answered,
    remaining: AGREEMENT_FLOW.length - answered,
    status: application.status,
  };
}

function getMissingFields(application) {
  return AGREEMENT_FLOW.filter((step) => {
    const value = normalizeValue(application.answers[step.key]);
    return step.required && value.length === 0;
  }).map((step) => step.key);
}

function validateAnswer(step, answer) {
  const normalized = normalizeValue(answer);

  if (!step) return true;

  if (step.key === 'email') {
    return /\S+@\S+\.\S+/.test(normalized);
  }

  if (step.key === 'agreementAcknowledgement') {
    const lower = normalized.toLowerCase();
    return lower.includes('i acknowledge') && lower.includes('agree');
  }

  return normalized.length >= 2;
}

function getSectionText(step, index) {
  if (!step) return 'You have completed all required agreement sections.';
  return `Section ${index + 1} of ${AGREEMENT_FLOW.length}: ${step.title}\n\n${step.explanation}\n\n${step.question}`;
}

function getFaqReply(message) {
  const lower = normalizeValue(message).toLowerCase();
  for (const faq of FAQ_LIBRARY) {
    if (faq.keywords.some((keyword) => lower.includes(keyword))) {
      return faq.reply;
    }
  }
  return null;
}

function setSubmittedState(application) {
  application.status = 'submitted';
  application.submittedAt = new Date().toISOString();
  application.updatedAt = application.submittedAt;
  application.paymentStatus = 'pending';
  application.approvalStatus = 'pending';
  application.accessStatus = 'not_authorized';
}

function setStatusSummary(application) {
  const currentStep = getCurrentStep(application);
  const missing = getMissingFields(application);

  if (application.status === 'submitted') {
    return 'Submitted';
  }

  if (missing.length === 0 && currentStep === null) {
    return 'Awaiting review';
  }

  if (currentStep) {
    return 'In progress';
  }

  return 'Awaiting submission';
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Agreement workflow is running.' });
});

app.post('/api/applications', (req, res) => {
  const application = buildApplication();
  saveApplication(application);
  return res.status(201).json({
    application,
    currentStep: getCurrentStep(application),
    progress: getProgress(application),
    missingFields: getMissingFields(application),
  });
});

app.get('/api/applications/:id', (req, res) => {
  const application = getApplicationById(req.params.id);
  if (!application) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  return res.json({
    application,
    currentStep: getCurrentStep(application),
    progress: getProgress(application),
    missingFields: getMissingFields(application),
    statusLabel: setStatusSummary(application),
  });
});

app.post('/api/applications/:id/answer', (req, res) => {
  const application = getApplicationById(req.params.id);
  const { key, value } = req.body || {};

  if (!application) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  const step = AGREEMENT_FLOW.find((item) => item.key === key);
  if (!step) {
    return res.status(400).json({ error: 'Unknown agreement field.' });
  }

  const normalized = normalizeValue(value);
  if (!normalized) {
    return res.status(400).json({ error: 'Answer is required.' });
  }

  if (!validateAnswer(step, normalized)) {
    return res.status(400).json({
      error: `That response does not match the expected format for ${step.label}.`,
      expected: step.question,
    });
  }

  application.answers[key] = normalized;
  application.updatedAt = new Date().toISOString();

  const currentStep = getCurrentStep(application);
  if (currentStep && currentStep.key === key && application.currentStep < AGREEMENT_FLOW.length - 1) {
    application.currentStep += 1;
  }

  if (getMissingFields(application).length === 0 && application.status !== 'submitted') {
    application.status = 'awaiting_review';
  }

  saveApplication(application);

  return res.json({
    application,
    currentStep: getCurrentStep(application),
    progress: getProgress(application),
    missingFields: getMissingFields(application),
  });
});

app.post('/api/applications/:id/clarify', (req, res) => {
  const application = getApplicationById(req.params.id);
  const question = normalizeValue(req.body?.question);

  if (!application) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  if (!question) {
    return res.status(400).json({ error: 'A clarification question is required.' });
  }

  const faqReply = getFaqReply(question);
  if (faqReply) {
    return res.json({
      reply: faqReply,
      currentStep: getCurrentStep(application),
      progress: getProgress(application),
      applicationId: application.id,
    });
  }

  return res.json({
    reply: 'I cannot confirm that answer from the approved FAQ or agreement wording. Please ask Goddess Jade for clarification instead of guessing.',
    currentStep: getCurrentStep(application),
    progress: getProgress(application),
    applicationId: application.id,
  });
});

app.post('/api/applications/:id/submit', (req, res) => {
  const application = getApplicationById(req.params.id);
  if (!application) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  if (getMissingFields(application).length > 0) {
    return res.status(400).json({
      error: 'Required agreement fields are still missing.',
      missingFields: getMissingFields(application),
      progress: getProgress(application),
    });
  }

  setSubmittedState(application);
  saveApplication(application);

  return res.json({
    message: 'Agreement submitted successfully. Submission does not mean approval, payment verification, or Lockyn access authorization.',
    application,
    progress: getProgress(application),
    statusLabel: 'Submitted',
  });
});

app.get('/api/admin/applications', (req, res) => {
  const applications = readApplications();
  const summaries = applications.map((application) => ({
    id: application.id,
    status: application.status,
    paymentStatus: application.paymentStatus,
    approvalStatus: application.approvalStatus,
    accessStatus: application.accessStatus,
    submittedAt: application.submittedAt,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    currentStep: application.currentStep,
    progress: getProgress(application),
    answers: application.answers,
  }));

  return res.json({ applications: summaries });
});

app.post('/api/admin/applications/:id/approve', (req, res) => {
  const application = getApplicationById(req.params.id);
  if (!application) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  application.approvalStatus = 'approved';
  application.status = 'approved';
  application.updatedAt = new Date().toISOString();
  if (application.paymentStatus === 'verified' && application.approvalStatus === 'approved') {
    application.accessStatus = 'authorized';
  }
  saveApplication(application);

  return res.json({ application });
});

app.post('/api/admin/applications/:id/payment-verified', (req, res) => {
  const application = getApplicationById(req.params.id);
  if (!application) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  application.paymentStatus = 'verified';
  application.updatedAt = new Date().toISOString();
  if (application.paymentStatus === 'verified' && application.approvalStatus === 'approved') {
    application.accessStatus = 'authorized';
  }
  saveApplication(application);

  return res.json({ application });
});

app.post('/api/chat', (req, res) => {
  const message = normalizeValue(req.body?.message);
  const applicationId = req.body?.applicationId || null;

  if (!message) {
    return res.status(400).json({ error: 'Message must be a string.' });
  }

  let application = applicationId ? getApplicationById(applicationId) : null;
  if (!application) {
    application = buildApplication();
    saveApplication(application);
  }

  const faqReply = getFaqReply(message);
  if (faqReply) {
    return res.json({
      applicationId: application.id,
      reply: faqReply + '\n\n' + getSectionText(getCurrentStep(application), application.currentStep),
      status: application.status,
      progress: getProgress(application),
      currentStep: getCurrentStep(application),
      missingFields: getMissingFields(application),
    });
  }

  const lower = message.toLowerCase();
  if (lower === 'status' || lower === 'application status') {
    return res.json({
      applicationId: application.id,
      reply: `Status: ${setStatusSummary(application)}. ${getProgress(application).answered}/${getProgress(application).total} required answers completed.`,
      status: application.status,
      progress: getProgress(application),
      currentStep: getCurrentStep(application),
      missingFields: getMissingFields(application),
    });
  }

  if (lower === 'submit' || lower === 'final submit') {
    if (getMissingFields(application).length > 0) {
      return res.status(400).json({
        error: 'Required agreement fields are still missing before submission.',
        missingFields: getMissingFields(application),
        progress: getProgress(application),
      });
    }

    setSubmittedState(application);
    saveApplication(application);

    return res.json({
      applicationId: application.id,
      reply: 'Your agreement has been submitted successfully. Submission does not mean Goddess Jade has approved the application, verified payment, or authorized Lockyn access.',
      status: application.status,
      progress: getProgress(application),
      currentStep: null,
      missingFields: [],
    });
  }

  const currentStep = getCurrentStep(application);
  if (!currentStep) {
    return res.json({
      applicationId: application.id,
      reply: 'All required agreement questions have been completed. Please review your answers and type "submit" when ready.',
      status: application.status,
      progress: getProgress(application),
      currentStep: null,
      missingFields: [],
    });
  }

  const valid = validateAnswer(currentStep, message);
  if (!valid) {
    return res.status(400).json({
      error: `That answer does not match the required response. Please try again: ${currentStep.question}`,
      currentStep,
      progress: getProgress(application),
    });
  }

  application.answers[currentStep.key] = message;
  application.updatedAt = new Date().toISOString();

  if (application.currentStep < AGREEMENT_FLOW.length - 1) {
    application.currentStep += 1;
    const nextStep = getCurrentStep(application);
    saveApplication(application);

    return res.json({
      applicationId: application.id,
      reply: `Saved. ${getSectionText(nextStep, application.currentStep)}`,
      status: application.status,
      progress: getProgress(application),
      currentStep: nextStep,
      missingFields: getMissingFields(application),
    });
  }

  application.status = 'awaiting_review';
  saveApplication(application);

  return res.json({
    applicationId: application.id,
    reply: 'All required agreement responses have been captured. Please review your answers and type "submit" to finalize the agreement.',
    status: application.status,
    progress: getProgress(application),
    currentStep: null,
    missingFields: [],
  });
});

app.get('/direct-form', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'direct-form.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Agreement workflow app listening at http://localhost:${PORT}`);
});

module.exports = {
  AGREEMENT_FLOW,
  FAQ_LIBRARY,
};




































































