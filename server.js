const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const agreementSections = [
  {
    id: 'intro',
    title: 'Agreement Overview',
    intro: 'This section introduces the agreement and explains what you are reviewing before you begin answering questions.',
    clause: 'This agreement governs participation in the No Nut November 2026 program and requires full, truthful completion of all required disclosures and acknowledgments before approval or access is granted.',
    plainLanguage: 'This is the official agreement. You are confirming that you understand the terms and are ready to proceed in good faith.',
    questions: [
      {
        key: 'understands_intro',
        prompt: 'Do you understand that this is the official agreement and that completion is required before approval? Reply with yes or no.',
        required: true,
        type: 'yes_no'
      }
    ]
  },
  {
    id: 'eligibility',
    title: 'Eligibility and Participation',
    intro: 'This section covers your eligibility, participation requirements, and the responsibilities you are agreeing to follow.',
    clause: 'Applicants must provide accurate information about their eligibility, participation, and relevant requirements for the program. Incomplete or inaccurate information may affect eligibility and approval.',
    plainLanguage: 'You are agreeing to provide truthful information and complete all required steps before the process can move forward.',
    questions: [
      {
        key: 'eligibility_confirmed',
        prompt: 'Please confirm that the information you provide about your eligibility is accurate and complete.',
        required: true,
        type: 'text'
      }
    ]
  },
  {
    id: 'acknowledgment',
    title: 'Acknowledgment and Consent',
    intro: 'This section covers the formal acknowledgment that you understand the agreement and are consenting to its terms.',
    clause: 'By signing or acknowledging this agreement, the applicant confirms they have reviewed the terms, understand the obligations, and agree to proceed only after completing all required steps.',
    plainLanguage: 'This is the formal consent step. Reading the agreement alone is not enough; explicit acknowledgment is required before submission.',
    questions: [
      {
        key: 'agreement_acknowledged',
        prompt: 'Do you acknowledge and agree to the terms of the agreement? Reply with “I agree” or “I do not agree”.',
        required: true,
        type: 'yes_no'
      },
      {
        key: 'signature',
        prompt: 'Please enter your full name as your agreement signature.',
        required: true,
        type: 'text'
      }
    ]
  }
];

const faqLibrary = {
  'what does this mean': 'This section explains the same agreement requirement in simpler language. It is not a new rule or an exception.',
  'what am i agreeing to': 'You are agreeing to the official agreement terms and to answer each required question truthfully before proceeding.',
  'can you explain this simply': 'In plain language, this means you understand the requirement, answer it honestly, and complete the required steps in order.',
  'what happens if i miss a payment deadline': 'I cannot confirm a payment policy without the approved payment policy or the current agreement language. Please contact Goddess Jade directly for any payment-related clarification.',
  'what if i need to update one of my answers': 'You can review and correct them before final submission. If you are unsure, ask for clarification before submitting.',
  'what does this requirement mean for my participation': 'This requirement is part of the agreement and affects whether you can continue according to the approved rules and process.',
  'can i ask goddess jade to clarify something before i agree': 'Yes. If the answer is not covered by the agreement or approved FAQ, ask Goddess Jade directly instead of guessing or assuming approval.',
  'what if i am just browsing': 'That is okay. You can ask questions and explore the agreement before deciding whether to continue. If you want, I can walk you through the process without pressure.',
  default: 'I can explain the current agreement section in plain language, but I cannot confirm a rule or exception that is not covered by the official agreement or the approved FAQ. Please contact Goddess Jade directly for any unclear policy matter.'
};

const sessions = new Map();

function makeSession(applicantId = 'guest') {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    applicantId,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    visitorType: 'browsing',
    engagementStatus: 'browsing_or_inquiry',
    agreementStarted: false,
    currentSectionIndex: 0,
    answers: {},
    completedSections: [],
    reviewComplete: false,
    submittedAt: null,
    status: 'in_progress',
    reminderState: { firstSent: false, secondSent: false },
    events: [],
    version: 'No Nut November 2026 Agreement - Prototype'
  };
}

function recordEvent(session, type, note = '') {
  session.events.push({ type, note, at: new Date().toISOString() });
  session.lastUpdated = new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function currentSection(session) {
  return agreementSections[session.currentSectionIndex] || null;
}

function isRequiredAnswered(session, section) {
  return (section.questions || []).every((question) => {
    const value = session.answers[question.key];
    return !question.required || (typeof value === 'string' && value.trim().length > 0);
  });
}

function getSessionSummary(session) {
  return {
    id: session.id,
    applicantId: session.applicantId,
    visitorType: session.visitorType,
    engagementStatus: session.engagementStatus,
    agreementStarted: session.agreementStarted,
    currentSectionIndex: session.currentSectionIndex,
    currentSection: currentSection(session)?.title || null,
    completedSections: session.completedSections,
    reviewComplete: session.reviewComplete,
    submittedAt: session.submittedAt,
    status: session.status,
    totalSections: agreementSections.length,
    answers: session.answers,
    events: session.events.slice(-10)
  };
}

function setEngagementStatus(session, status, visitorType) {
  session.engagementStatus = status;
  if (visitorType) session.visitorType = visitorType;
  recordEvent(session, 'engagement_status_changed', `${status}:${visitorType || session.visitorType}`);
}

function answerQuestion(session, questionKey, rawAnswer) {
  const section = currentSection(session);
  const question = (section?.questions || []).find((item) => item.key === questionKey);

  if (!question) {
    return { ok: false, message: 'That question is not part of the current section.' };
  }

  const answer = normalizeText(rawAnswer);
  if (!answer) {
    return { ok: false, message: `Please provide an answer for: ${question.prompt}` };
  }

  if (question.type === 'yes_no') {
    const cleaned = answer.toLowerCase();
    const acceptable = ['yes', 'no', 'i agree', 'i do not agree'];
    if (!acceptable.includes(cleaned)) {
      return { ok: false, message: 'Please answer with yes, no, I agree, or I do not agree.' };
    }
  }

  session.answers[questionKey] = answer;
  recordEvent(session, 'question_answered', `${questionKey}:${answer}`);

  const sectionCompleted = isRequiredAnswered(session, section);
  if (sectionCompleted) {
    session.completedSections = Array.from(new Set([...session.completedSections, section.id]));
    session.currentSectionIndex += 1;
    recordEvent(session, 'section_completed', section.title);

    const next = currentSection(session);
    return {
      ok: true,
      sectionComplete: true,
      nextSection: next,
      message: next
        ? `Section complete. We are moving to: ${next.title}. ${next.intro}`
        : 'All agreement sections are complete. Please review before submitting.'
    };
  }

  return {
    ok: true,
    sectionComplete: false,
    message: 'Your answer was saved. Please continue with the remaining required question(s) in this section.'
  };
}

function faqAnswer(questionText) {
  const text = normalizeText(questionText).toLowerCase();

  for (const key of Object.keys(faqLibrary)) {
    if (key !== 'default' && text.includes(key)) {
      return faqLibrary[key];
    }
  }

  return faqLibrary.default;
}

function classifyVisitor(message) {
  const lower = normalizeText(message).toLowerCase();

  if (/(just looking|just browsing|lurking|lurker|curious|not sure)/.test(lower)) {
    return 'browsing';
  }

  if (/(apply|agreement|start|begin|continue|resume|payment|submit)/.test(lower)) {
    return 'applicant';
  }

  return 'inquiry';
}

function generateReply(session, message) {
  const lower = normalizeText(message).toLowerCase();

  if (!lower) {
    return 'Please type a message so I can help you continue.';
  }

  if (/(just looking|just browsing|lurking|lurker|curious|not sure)/.test(lower)) {
    session.visitorType = 'browsing';
    setEngagementStatus(session, 'browsing_or_inquiry', 'browsing');
    return 'That is okay. You can ask questions and explore the agreement before deciding whether to continue. If you want, I can explain the process in plain language and help you decide whether you want to begin.';
  }

  if (/(payment|paid|submit payment|payment instructions)/.test(lower)) {
    session.visitorType = 'applicant';
    setEngagementStatus(session, 'awaiting_payment', 'applicant');
    return 'Your application and payment are separate steps. The application is not approved until the required review and payment verification are complete. If you want, I can walk you through the payment instructions next.';
  }

  if (/(resume|continue|return|left off|stuck)/.test(lower)) {
    session.agreementStarted = true;
    session.visitorType = 'applicant';
    setEngagementStatus(session, 'agreement_in_progress', 'applicant');
    const current = currentSection(session);
    return current
      ? `Let’s continue where you left off. ${current.title}\n\n${current.intro}\n\n${current.questions.map((q) => q.prompt).join('\n')}`
      : 'You are ready to review or submit. Your progress has been preserved.';
  }

  if (/(question|what does|explain|clarify|what am i agreeing to|what happens)/.test(lower)) {
    session.visitorType = classifyVisitor(message);
    setEngagementStatus(session, 'browsing_or_inquiry', session.visitorType === 'browsing' ? 'browsing' : 'inquiry');
    return faqAnswer(message);
  }

  if (/(start|begin|apply|agreement)/.test(lower) || session.agreementStarted) {
    session.agreementStarted = true;
    session.visitorType = 'applicant';
    setEngagementStatus(session, 'agreement_in_progress', 'applicant');
    const current = currentSection(session);
    if (!current) {
      return 'The agreement walkthrough is complete. Please review before submitting.';
    }
    return `${current.title}\n\n${current.intro}\n\n${current.clause}\n\n${current.plainLanguage}\n\n${current.questions.map((q) => q.prompt).join('\n')}`;
  }

  if (/(hello|hi|hey|good morning|good evening)/.test(lower)) {
    session.visitorType = classifyVisitor(message);
    setEngagementStatus(session, 'browsing_or_inquiry', 'inquiry');
    return 'Hi. I can explain the agreement, answer questions, and help you continue through the application if you are ready.';
  }

  if (/(bye|goodbye)/.test(lower)) {
    return 'Goodbye. If you want to come back later, I can help you resume where you left off.';
  }

  if (lower.includes('help')) {
    return 'I can explain the agreement in plain language, answer questions, help you continue the walkthrough, or explain what remains incomplete before submission.';
  }

  return 'I can help explain the agreement, answer questions before you proceed, or continue the walkthrough when you are ready.';
}

app.post('/api/chat', (req, res) => {
  const { sessionId, message } = req.body || {};
  let session = sessionId ? getSession(sessionId) : null;

  if (!session) {
    session = makeSession('guest');
    sessions.set(session.id, session);
    recordEvent(session, 'session_started', 'New visitor session created.');
  }

  if (typeof message !== 'string' || !normalizeText(message)) {
    return res.status(400).json({ error: 'A message is required.' });
  }

  const reply = generateReply(session, message);
  const summary = getSessionSummary(session);

  return res.json({
    sessionId: session.id,
    reply,
    session: summary
  });
});

app.post('/api/agreement/start', (req, res) => {
  const { applicantId = 'guest' } = req.body || {};
  const session = makeSession(applicantId);
  sessions.set(session.id, session);
  session.agreementStarted = true;
  recordEvent(session, 'agreement_started', 'Applicant started the agreement walkthrough.');
  setEngagementStatus(session, 'agreement_in_progress', 'applicant');

  const current = currentSection(session);
  return res.json({
    sessionId: session.id,
    session: getSessionSummary(session),
    botMessage: {
      type: 'section_start',
      text: `${current.title}\n\n${current.intro}\n\n${current.clause}\n\n${current.plainLanguage}\n\n${current.questions.map((q) => q.prompt).join('\n')}`
    }
  });
});

app.post('/api/agreement/answer', (req, res) => {
  const { sessionId, questionKey, answer } = req.body || {};
  const session = getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const result = answerQuestion(session, questionKey, answer);
  if (!result.ok) {
    return res.status(400).json({ error: result.message });
  }

  session.agreementStarted = true;
  setEngagementStatus(session, 'agreement_in_progress', 'applicant');

  return res.json({
    sessionId: session.id,
    success: true,
    sectionComplete: result.sectionComplete,
    message: result.message,
    session: getSessionSummary(session)
  });
});

app.post('/api/agreement/review', (req, res) => {
  const { sessionId } = req.body || {};
  const session = getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const missing = [];
  for (const section of agreementSections) {
    if (!isRequiredAnswered(session, section)) {
      missing.push(section.title);
    }
  }

  session.reviewComplete = true;
  recordEvent(session, 'review_started', missing.length ? `Missing sections: ${missing.join(', ')}` : 'Review completed.');

  return res.json({
    success: true,
    session: getSessionSummary(session),
    missing,
    botMessage: {
      type: 'review',
      text: missing.length
        ? `Review is available, but the following sections still need completion: ${missing.join(', ')}.`
        : 'Review complete. Before final submission, confirm that your answers are accurate and that you explicitly acknowledge the agreement.'
    }
  });
});

app.post('/api/agreement/submit', (req, res) => {
  const { sessionId, finalConfirmation } = req.body || {};
  const session = getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const missing = [];
  for (const section of agreementSections) {
    if (!isRequiredAnswered(session, section)) {
      missing.push(section.title);
    }
  }

  const ack = normalizeText(finalConfirmation || '').toLowerCase();
  if (missing.length > 0 || !(ack === 'i agree' || ack === 'yes' || ack === 'yes, i agree')) {
    return res.status(400).json({
      error: 'Submission is blocked until required responses are complete and the final acknowledgment is explicitly provided.',
      missing,
      session: getSessionSummary(session)
    });
  }

  session.status = 'submitted';
  session.submittedAt = new Date().toISOString();
  session.reviewComplete = true;
  setEngagementStatus(session, 'agreement_completed', 'applicant');
  recordEvent(session, 'agreement_submitted', 'Agreement submitted; approval, payment verification, and access release remain separate steps.');

  return res.json({
    success: true,
    session: getSessionSummary(session),
    botMessage: {
      type: 'submit',
      text: 'Agreement submitted successfully. This does not mean approval, payment verification, or access release has been granted.'
    }
  });
});

app.get('/api/dashboard/summary', (req, res) => {
  const statuses = { browsing_or_inquiry: 0, agreement_in_progress: 0, awaiting_payment: 0, agreement_completed: 0, submitted: 0 };

  for (const session of sessions.values()) {
    if (statuses[session.engagementStatus] !== undefined) {
      statuses[session.engagementStatus] += 1;
    }
    if (session.status === 'submitted') {
      statuses.submitted += 1;
    }
  }

  return res.json({
    summary: {
      totalSessions: sessions.size,
      browsing_or_inquiry: statuses.browsing_or_inquiry,
      agreement_in_progress: statuses.agreement_in_progress,
      awaiting_payment: statuses.awaiting_payment,
      agreement_completed: statuses.agreement_completed,
      submitted: statuses.submitted
    },
    note: 'This is a prototype engagement summary. A real system should use authenticated applicant records and confirmed events only.'
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Agreement chatbot prototype listening at http://localhost:${PORT}`);
});
