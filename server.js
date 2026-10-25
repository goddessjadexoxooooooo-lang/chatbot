const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const STORAGE_DIR = path.join(__dirname, 'data');
const STORAGE_FILE = path.join(STORAGE_DIR, 'applications.json');

const AGREEMENT_FLOW = [
  {
    key: 'fullName',
    title: 'Applicant Information',
    explanation: 'This section captures the applicant name so the application can be matched to the correct record.',
    question: 'What is your full legal name?',
    required: true,
  },
  {
    key: 'email',
    title: 'Contact Information',
    explanation: 'We use this to contact you about your application status and any follow-up requirements.',
    question: 'What is your email address?',
    required: true,
  },
  {
    key: 'agreementAcknowledgement',
    title: 'Agreement Acknowledgment',
    explanation: 'This confirms you have reviewed the agreement and understand that you are agreeing to its terms.',
    question: 'Please type: I acknowledge that I have reviewed the agreement and agree to its terms.',
    required: true,
  },
  {
    key: 'signature',
    title: 'Final Signature',
    explanation: 'This is the final consent step. The signature is recorded as part of the submitted application record.',
    question: 'Please type your full legal name again to sign the agreement.',
    required: true,
  },
];

const FAQ_LIBRARY = [
  {
    matches: ['what does this mean', 'what am i agreeing to', 'what does this section mean', 'what does this say'],
    reply: 'This section explains the agreement requirement and asks for your answer. It does not change the terms of the agreement. If you are unsure, answer based on the exact wording provided and ask Goddess Jade for clarification if needed.',
  },
  {
    matches: ['can you explain this in simpler terms', 'simpler terms', 'plain language'],
    reply: 'In plain language, this step is asking you to confirm that you understand the requirement and are willing to proceed under the agreement as written. It is not a separate agreement or a promise of approval.',
  },
  {
    matches: ['what if i need to update one of my answers', 'update my answer', 'change my answer'],
    reply: 'You may update your answers before final submission. The system will preserve your progress and save the latest version as part of the same application record.',
  },
  {
    matches: ['what if i miss a payment deadline', 'payment deadline', 'miss a payment'],
    reply: 'Payment deadlines are part of the approval and verification process. If you are unsure about a specific deadline, please ask Goddess Jade directly rather than guessing. Submission does not mean approval or payment verification.',
  },
  {
    matches: ['what happens if i do not finish', 'not complete', 'unfinished agreement'],
    reply: 'The agreement remains in progress until all required fields are completed and submitted. Incomplete agreements are not treated as final consent.',
  },
  {
    matches: ['who can answer this', 'who approves', 'can goddess jade clarify'],
    reply: 'If the answer is not covered by the approved FAQ or agreement text, the chatbot should direct you to Goddess Jade for clarification. It should not guess or invent policy.',
  },
];

function ensureStorage() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }

  if (!fs.existsSync(STORAGE_FILE)) {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify([], null, 2));
  }
}

function readApplications() {
  ensureStorage();
  const raw = fs.readFileSync(STORAGE_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function writeApplications(applications) {
  ensureStorage();
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(applications, null, 2));
}

function createApplication() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: 'in_progress',
    currentStep: 0,
    answers: {},
    submittedAt: null,
    submissionVersion: 'v1',
    paymentStatus: 'pending',
    approvalStatus: 'pending',
    accessStatus: 'not_authorized',
  };
}

function getApplicationById(appId) {
  const applications = readApplications();
  return applications.find((application) => application.id === appId) || null;
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

function normalizeMessage(value) {
  return String(value || '').trim();
}

function getCurrentStep(application) {
  const stepIndex = application.currentStep || 0;
  return AGREEMENT_FLOW[stepIndex] || null;
}

function getMissingFields(application) {
  return AGREEMENT_FLOW.filter((step) => step.required && !(application.answers[step.key] && String(application.answers[step.key]).trim().length)).map((step) => step.key);
}

function getProgressSummary(application) {
  const total = AGREEMENT_FLOW.length;
  const answered = AGREEMENT_FLOW.filter((step) => application.answers[step.key]).length;
  return {
    total,
    answered,
    remaining: total - answered,
    currentStep: getCurrentStep(application)?.title || 'Review',
  };
}

function findFaqReply(message) {
  const lower = normalizeMessage(message).toLowerCase();
  for (const faq of FAQ_LIBRARY) {
    if (faq.matches.some((pattern) => lower.includes(pattern))) {
      return faq.reply;
    }
  }
  return null;
}

function getSectionIntro(step, index) {
  return `Section ${index + 1} of ${AGREEMENT_FLOW.length}: ${step.title}\n\n${step.explanation}\n\n${step.question}`;
}

function buildReplyForApplication(application) {
  const step = getCurrentStep(application);
  if (!step) {
    if (application.status === 'submitted') {
      return 'Your agreement has been submitted. Submission does not mean approval, payment verification, or access authorization.';
    }

    const missing = getMissingFields(application);
    if (missing.length === 0) {
      return 'You have completed the required agreement steps. Please review your answers and type "submit" to finalize the agreement.';
    }

    return `You are at the final review stage. Please review your answers before submitting. Missing fields: ${missing.join(', ')}`;
  }

  return getSectionIntro(step, application.currentStep);
}

function validateAnswer(step, answer) {
  if (!step) return true;

  if (step.key === 'email') {
    return /\S+@\S+\.\S+/.test(answer);
  }

  if (step.key === 'agreementAcknowledgement') {
    return answer.toLowerCase().includes('i acknowledge') && answer.toLowerCase().includes('agree');
  }

  if (step.key === 'signature') {
    return answer.trim().length >= 2;
  }

  return answer.trim().length >= 2;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Agreement chatbot is running.' });
});

app.get('/api/application/:id', (req, res) => {
  const application = getApplicationById(req.params.id);
  if (!application) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  const progress = getProgressSummary(application);
  return res.json({
    application,
    progress,
    currentStep: getCurrentStep(application),
    missingFields: getMissingFields(application),
  });
});

app.post('/api/chat', (req, res) => {
  const message = normalizeMessage(req.body.message);
  const applicationId = req.body.applicationId || null;

  if (!message) {
    return res.status(400).json({ error: 'Message must be a string.' });
  }

  let application = applicationId ? getApplicationById(applicationId) : null;

  if (!application) {
    application = createApplication();
    saveApplication(application);
  }

  const faqReply = findFaqReply(message);
  if (faqReply) {
    application.updatedAt = new Date().toISOString();
    saveApplication(application);
    return res.json({
      applicationId: application.id,
      reply: faqReply + '\n\n' + buildReplyForApplication(application),
      status: application.status,
      progress: getProgressSummary(application),
      currentStep: getCurrentStep(application),
      missingFields: getMissingFields(application),
    });
  }

  if (message.toLowerCase() === 'status') {
    const progress = getProgressSummary(application);
    return res.json({
      applicationId: application.id,
      reply: `Agreement status: ${application.status}. ${progress.answered}/${progress.total} required answers completed.`,
      status: application.status,
      progress,
      currentStep: getCurrentStep(application),
      missingFields: getMissingFields(application),
    });
  }

  if (message.toLowerCase() === 'submit' || message.toLowerCase() === 'final submit') {
    const missing = getMissingFields(application);
    if (missing.length > 0) {
      return res.json({
        applicationId: application.id,
        reply: `You still need to complete the following required fields before submission: ${missing.join(', ')}.`,
        status: application.status,
        progress: getProgressSummary(application),
        currentStep: getCurrentStep(application),
        missingFields: missing,
      });
    }

    application.status = 'submitted';
    application.submittedAt = new Date().toISOString();
    application.updatedAt = application.submittedAt;
    saveApplication(application);

    return res.json({
      applicationId: application.id,
      reply: 'Your agreement has been submitted successfully. Submission does not mean Goddess Jade has approved your application, verified payment, or authorized Lockyn access.',
      status: application.status,
      progress: getProgressSummary(application),
      currentStep: null,
      missingFields: [],
    });
  }

  const currentStep = getCurrentStep(application);
  if (!currentStep) {
    const responseText = 'All required agreement fields are complete. Please review your answers and type "submit" when ready.';
    return res.json({
      applicationId: application.id,
      reply: responseText,
      status: application.status,
      progress: getProgressSummary(application),
      currentStep: null,
      missingFields: [],
    });
  }

  const answer = normalizeMessage(message);
  const valid = validateAnswer(currentStep, answer);

  if (!valid) {
    return res.json({
      applicationId: application.id,
      reply: `That response does not match the required field for this section. Please try again: ${currentStep.question}`,
      status: application.status,
      progress: getProgressSummary(application),
      currentStep,
      missingFields: getMissingFields(application),
    });
  }

  application.answers[currentStep.key] = answer;
  application.updatedAt = new Date().toISOString();

  if (application.currentStep < AGREEMENT_FLOW.length - 1) {
    application.currentStep += 1;
    const nextStep = getCurrentStep(application);
    saveApplication(application);

    return res.json({
      applicationId: application.id,
      reply: `Saved. ${getSectionIntro(nextStep, application.currentStep)}`,
      status: application.status,
      progress: getProgressSummary(application),
      currentStep: nextStep,
      missingFields: getMissingFields(application),
    });
  }

  application.status = 'awaiting_review';
  application.updatedAt = new Date().toISOString();
  saveApplication(application);

  return res.json({
    applicationId: application.id,
    reply: 'All required agreement responses have been captured. Please review your answers and type "submit" to finalize the agreement.',
    status: application.status,
    progress: getProgressSummary(application),
    currentStep: null,
    missingFields: [],
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Agreement chatbot listening at http://localhost:${PORT}`);
});

module.exports = { AGREEMENT_FLOW, FAQ_LIBRARY };










































































































































































