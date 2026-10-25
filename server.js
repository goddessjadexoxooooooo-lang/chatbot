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
    intro: 'This first step introduces the agreement and explains what you are reviewing before you begin answering questions.',
    clause: 'This agreement governs participation in the No Nut November 2026 program and requires full, truthful completion of all required disclosures and acknowledgments before approval or access is granted.',
    plainLanguage: 'This section explains that the agreement is the official program terms and that you must answer all required questions honestly before anything is approved.',
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
    plainLanguage: 'You are agreeing to provide truthful information and complete all required steps before the program can move forward.',
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
    plainLanguage: 'This is the formal consent step. Reading the agreement alone is not enough; you must explicitly acknowledge and complete the required consent before submission.',
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
  'what does this mean': 'This section explains the specific agreement requirement in clearer language. It is not a new rule; it is the same provision explained in simpler terms.',
  'what am i agreeing to': 'You are agreeing to the terms of the official agreement as presented in this walkthrough and to answer each required question truthfully.',
  'can you explain this simply': 'In plain language, this means you are confirming your understanding and agreeing to complete the required steps honestly and in order.',
  'what happens if i miss a payment deadline': 'I cannot confirm a payment policy without the approved payment policy or the current agreement language. Please contact Goddess Jade directly for any payment-related clarification.',
  'what if i need to update one of my answers': 'You may review and correct your responses before final submission. If you require clarification, ask before submitting and follow the current application instructions.',
  'what does this requirement mean for my participation': 'This requirement is part of the agreement and affects whether you can proceed with the program according to the approved terms and process.',
  'can i ask goddess jade to clarify something before i agree': 'Yes. If the answer is not covered by the agreement or the approved FAQ, you should ask Goddess Jade directly rather than guessing or assuming approval.',
  default: 'I can explain the current agreement section in plain language, but I cannot confirm a rule or exception that is not covered by the official agreement or the approved FAQ. Please contact Goddess Jade directly for any unclear policy matter.'
};

const sessions = new Map();

function makeSession(applicantId = 'guest') {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    applicantId,
    currentSectionIndex: 0,
    answers: {},
    completedSections: [],
    status: 'in_progress',
    submittedAt: null,
    version: 'No Nut November 2026 Agreement - Walkthrough Prototype',
    reviewComplete: false
  };
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function currentSection(session) {
  return agreementSections[session.currentSectionIndex] || null;
}

function isRequiredAnswered(session, section) {
  return (section.questions || []).every((question) => {
    const answer = session.answers[question.key];
    return !question.required || (typeof answer === 'string' && answer.trim().length > 0);
  });
}

function getSessionSummary(session) {
  return {
    id: session.id,
    applicantId: session.applicantId,
    status: session.status,
    currentSectionIndex: session.currentSectionIndex,
    currentSection: currentSection(session)?.title || null,
    completedSections: session.completedSections,
    reviewComplete: session.reviewComplete,
    submittedAt: session.submittedAt,
    totalSections: agreementSections.length,
    answers: session.answers
  };
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
    const yesNo = answer.toLowerCase();
    if (yesNo !== 'yes' && yesNo !== 'i agree' && yesNo !== 'i do not agree' && yesNo !== 'no') {
      return { ok: false, message: 'Please answer with yes, no, I agree, or I do not agree.' };
    }
  }

  session.answers[questionKey] = answer;

  const sectionFinished = isRequiredAnswered(session, section);
  if (sectionFinished) {
    session.completedSections = Array.from(new Set([...session.completedSections, section.id]));
    session.currentSectionIndex += 1;
    return {
      ok: true,
      sectionComplete: true,
      currentSection: currentSection(session),
      message: 'Section complete. Moving to the next section.'
    };
  }

  return {
    ok: true,
    sectionComplete: false,
    currentSection: section,
    message: 'Your answer has been saved. Please continue with the remaining required question(s) in this section.'
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

app.get('/api/agreement/sections', (req, res) => {
  res.json({ sections: agreementSections });
});

app.post('/api/agreement/start', (req, res) => {
  const { applicantId = 'guest' } = req.body || {};
  const session = makeSession(applicantId);
  sessions.set(session.id, session);

  const current = currentSection(session);
  res.json({
    session: getSessionSummary(session),
    botMessage: {
      type: 'welcome',
      text: `Welcome. I will guide you through the agreement in sections. We will not jump ahead, and your answers will be saved as you progress.\n\nSection ${session.currentSectionIndex + 1} of ${agreementSections.length}: ${current.title}\n\n${current.intro}\n\n${current.clause}\n\n${current.plainLanguage}\n\nQuestion: ${current.questions[0].prompt}`
    }
  });
});

app.get('/api/agreement/session/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const current = currentSection(session);
  let promptText = 'No active section.';

  if (current) {
    promptText = `${current.title}\n\n${current.intro}\n\n${current.clause}\n\n${current.plainLanguage}\n\n${(current.questions || []).map((q) => q.prompt).join('\n')}`;
  }

  return res.json({
    session: getSessionSummary(session),
    botMessage: { type: 'section', text: promptText }
  });
});

app.post('/api/agreement/answer', (req, res) => {
  const { sessionId, questionKey, answer } = req.body || {};
  const session = getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  if (typeof questionKey !== 'string' || typeof answer !== 'string') {
    return res.status(400).json({ error: 'Question key and answer are required.' });
  }

  const result = answerQuestion(session, questionKey, answer);
  if (!result.ok) {
    return res.status(400).json({ error: result.message });
  }

  const next = currentSection(session);
  const responseText = result.sectionComplete
    ? `Your answer has been saved. ${next ? `You are now on: ${next.title}. ${next.intro}` : 'You have completed all sections. Please review before submitting.'}`
    : result.message;

  return res.json({
    success: true,
    session: getSessionSummary(session),
    botMessage: { type: 'answer', text: responseText }
  });
});

app.post('/api/agreement/question', (req, res) => {
  const { sessionId, question } = req.body || {};
  const session = getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const answer = faqAnswer(question || '');
  const current = currentSection(session);

  return res.json({
    success: true,
    session: getSessionSummary(session),
    botMessage: {
      type: 'faq',
      text: `${answer}\n\nWe have returned you to the current section: ${current?.title || 'agreement'} and your progress remains saved.`
    }
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

  return res.json({
    success: true,
    session: getSessionSummary(session),
    botMessage: {
      type: 'review',
      text: missing.length
        ? `Review is available, but the following sections still need completion: ${missing.join(', ')}.`
        : 'Review complete. Please confirm your answers are accurate before final submission. Final submission must use an explicit acknowledgment and signature.'
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

  const explicitAck = normalizeText(finalConfirmation || '').toLowerCase();
  if (missing.length > 0 || !(explicitAck === 'i agree' || explicitAck === 'yes, i agree' || explicitAck === 'yes')) {
    return res.status(400).json({
      error: 'Submission is blocked until required responses are complete and the final acknowledgment is explicitly provided.',
      missing
    });
  }

  session.status = 'submitted';
  session.submittedAt = new Date().toISOString();
  session.reviewComplete = true;

  return res.json({
    success: true,
    session: getSessionSummary(session),
    botMessage: {
      type: 'submit',
      text: 'Agreement submitted successfully. This indicates your agreement was submitted, but it does not mean approval, payment verification, or access release has been granted.'
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Agreement chatbot app listening at http://localhost:${PORT}`);
});
