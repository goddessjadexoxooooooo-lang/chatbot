const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

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

let db;

async function initDatabase() {
  db = await open({
    filename: path.join(__dirname, 'chatbot.db'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      applicant_id TEXT DEFAULT 'guest',
      visitor_type TEXT DEFAULT 'browsing',
      engagement_status TEXT DEFAULT 'browsing_or_inquiry',
      agreement_started INTEGER DEFAULT 0,
      current_section_index INTEGER DEFAULT 0,
      status TEXT DEFAULT 'in_progress',
      submitted_at TEXT,
      review_complete INTEGER DEFAULT 0,
      answers_json TEXT DEFAULT '{}',
      events_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || 'null');
    return parsed ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function currentSection(session) {
  return agreementSections[session.current_section_index] || null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function summarizeSession(session) {
  const current = currentSection(session);
  return {
    id: session.session_id,
    applicantId: session.applicant_id,
    visitorType: session.visitor_type,
    engagementStatus: session.engagement_status,
    agreementStarted: Boolean(session.agreement_started),
    currentSectionIndex: session.current_section_index,
    currentSection: current ? current.title : null,
    completedSections: session.completed_sections || [],
    reviewComplete: Boolean(session.review_complete),
    submittedAt: session.submitted_at,
    status: session.status,
    totalSections: agreementSections.length,
    answers: session.answers || {},
    events: (session.events || []).slice(-10)
  };
}

function makeSession(applicantId = 'guest') {
  const now = new Date().toISOString();
  return {
    session_id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    applicant_id: applicantId,
    visitor_type: 'browsing',
    engagement_status: 'browsing_or_inquiry',
    agreement_started: 0,
    current_section_index: 0,
    status: 'in_progress',
    submitted_at: null,
    review_complete: 0,
    answers: {},
    events: [],
    completed_sections: [],
    created_at: now,
    updated_at: now
  };
}

function recordEvent(session, type, note = '') {
  session.events.push({ type, note, at: new Date().toISOString() });
  session.updated_at = new Date().toISOString();
}

function setEngagementStatus(session, status, visitorType) {
  session.engagement_status = status;
  if (visitorType) session.visitor_type = visitorType;
  recordEvent(session, 'engagement_status_changed', `${status}:${visitorType || session.visitor_type}`);
}

async function saveSession(session) {
  if (!db) return session;

  const row = {
    session_id: session.session_id,
    applicant_id: session.applicant_id,
    visitor_type: session.visitor_type,
    engagement_status: session.engagement_status,
    agreement_started: session.agreement_started ? 1 : 0,
    current_section_index: session.current_section_index,
    status: session.status,
    submitted_at: session.submitted_at,
    review_complete: session.review_complete ? 1 : 0,
    answers_json: JSON.stringify(session.answers || {}),
    events_json: JSON.stringify(session.events || []),
    updated_at: session.updated_at,
    created_at: session.created_at
  };

  await db.run(
    `INSERT INTO sessions (
      session_id, applicant_id, visitor_type, engagement_status, agreement_started,
      current_section_index, status, submitted_at, review_complete, answers_json,
      events_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      applicant_id = excluded.applicant_id,
      visitor_type = excluded.visitor_type,
      engagement_status = excluded.engagement_status,
      agreement_started = excluded.agreement_started,
      current_section_index = excluded.current_section_index,
      status = excluded.status,
      submitted_at = excluded.submitted_at,
      review_complete = excluded.review_complete,
      answers_json = excluded.answers_json,
      events_json = excluded.events_json,
      updated_at = excluded.updated_at`,
    [
      row.session_id,
      row.applicant_id,
      row.visitor_type,
      row.engagement_status,
      row.agreement_started,
      row.current_section_index,
      row.status,
      row.submitted_at,
      row.review_complete,
      row.answers_json,
      row.events_json,
      row.created_at,
      row.updated_at
    ]
  );

  return session;
}

async function getSessionById(sessionId) {
  if (!db) return null;
  const row = await db.get('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
  if (!row) return null;

  const session = {
    session_id: row.session_id,
    applicant_id: row.applicant_id,
    visitor_type: row.visitor_type,
    engagement_status: row.engagement_status,
    agreement_started: Boolean(row.agreement_started),
    current_section_index: Number(row.current_section_index || 0),
    status: row.status,
    submitted_at: row.submitted_at,
    review_complete: Boolean(row.review_complete),
    answers: parseJson(row.answers_json, {}),
    events: parseJson(row.events_json, []),
    completed_sections: parseJson(row.completed_sections_json || '[]', []),
    created_at: row.created_at,
    updated_at: row.updated_at
  };

  // Backward-compatible fallback for older rows without completed_sections_json.
  const completed = parseJson(row.completed_sections_json, []);
  if (Array.isArray(completed) && completed.length) {
    session.completed_sections = completed;
  }

  return session;
}

function isRequiredAnswered(session, section) {
  return (section.questions || []).every((question) => {
    const value = session.answers[question.key];
    return !question.required || (typeof value === 'string' && value.trim().length > 0);
  });
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
  session.updated_at = new Date().toISOString();
  recordEvent(session, 'question_answered', `${questionKey}:${answer}`);

  const sectionCompleted = isRequiredAnswered(session, section);
  if (sectionCompleted) {
    session.completed_sections = Array.from(new Set([...session.completed_sections, section.id]));
    session.current_section_index += 1;
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
    session.visitor_type = 'browsing';
    setEngagementStatus(session, 'browsing_or_inquiry', 'browsing');
    return 'That is okay. You can ask questions and explore the agreement before deciding whether to continue. If you want, I can explain the process in plain language and help you decide whether you want to begin.';
  }

  if (/(payment|paid|submit payment|payment instructions)/.test(lower)) {
    session.visitor_type = 'applicant';
    setEngagementStatus(session, 'awaiting_payment', 'applicant');
    return 'Your application and payment are separate steps. The application is not approved until the required review and payment verification are complete. If you want, I can walk you through the payment instructions next.';
  }

  if (/(resume|continue|return|left off|stuck)/.test(lower)) {
    session.agreement_started = 1;
    session.visitor_type = 'applicant';
    setEngagementStatus(session, 'agreement_in_progress', 'applicant');
    const current = currentSection(session);
    return current
      ? `Let’s continue where you left off. ${current.title}\n\n${current.intro}\n\n${current.questions.map((q) => q.prompt).join('\n')}`
      : 'You are ready to review or submit. Your progress has been preserved.';
  }

  if (/(question|what does|explain|clarify|what am i agreeing to|what happens)/.test(lower)) {
    session.visitor_type = classifyVisitor(message);
    setEngagementStatus(session, 'browsing_or_inquiry', session.visitor_type === 'browsing' ? 'browsing' : 'inquiry');
    return faqAnswer(message);
  }

  if (/(start|begin|apply|agreement)/.test(lower) || session.agreement_started) {
    session.agreement_started = 1;
    session.visitor_type = 'applicant';
    setEngagementStatus(session, 'agreement_in_progress', 'applicant');
    const current = currentSection(session);
    if (!current) {
      return 'The agreement walkthrough is complete. Please review before submitting.';
    }
    return `${current.title}\n\n${current.intro}\n\n${current.clause}\n\n${current.plainLanguage}\n\n${current.questions.map((q) => q.prompt).join('\n')}`;
  }

  if (/(hello|hi|hey|good morning|good evening)/.test(lower)) {
    session.visitor_type = classifyVisitor(message);
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

app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body || {};
  let session = sessionId ? await getSessionById(sessionId) : null;

  if (!session) {
    session = makeSession('guest');
    recordEvent(session, 'session_started', 'New visitor session created.');
    await saveSession(session);
  }

  if (typeof message !== 'string' || !normalizeText(message)) {
    return res.status(400).json({ error: 'A message is required.' });
  }

  const reply = generateReply(session, message);
  await saveSession(session);

  return res.json({
    sessionId: session.session_id,
    reply,
    session: summarizeSession(session)
  });
});

app.post('/api/agreement/start', async (req, res) => {
  const { applicantId = 'guest' } = req.body || {};
  const session = makeSession(applicantId);
  session.agreement_started = 1;
  recordEvent(session, 'agreement_started', 'Applicant started the agreement walkthrough.');
  setEngagementStatus(session, 'agreement_in_progress', 'applicant');
  await saveSession(session);

  const current = currentSection(session);
  return res.json({
    sessionId: session.session_id,
    session: summarizeSession(session),
    botMessage: {
      type: 'section_start',
      text: `${current.title}\n\n${current.intro}\n\n${current.clause}\n\n${current.plainLanguage}\n\n${current.questions.map((q) => q.prompt).join('\n')}`
    }
  });
});

app.post('/api/agreement/answer', async (req, res) => {
  const { sessionId, questionKey, answer } = req.body || {};
  const session = await getSessionById(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const result = answerQuestion(session, questionKey, answer);
  if (!result.ok) {
    return res.status(400).json({ error: result.message });
  }

  session.agreement_started = 1;
  setEngagementStatus(session, 'agreement_in_progress', 'applicant');
  await saveSession(session);

  return res.json({
    sessionId: session.session_id,
    success: true,
    sectionComplete: result.sectionComplete,
    message: result.message,
    session: summarizeSession(session)
  });
});

app.post('/api/agreement/review', async (req, res) => {
  const { sessionId } = req.body || {};
  const session = await getSessionById(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const missing = [];
  for (const section of agreementSections) {
    if (!isRequiredAnswered(session, section)) {
      missing.push(section.title);
    }
  }

  session.review_complete = true;
  recordEvent(session, 'review_started', missing.length ? `Missing sections: ${missing.join(', ')}` : 'Review completed.');
  await saveSession(session);

  return res.json({
    success: true,
    session: summarizeSession(session),
    missing,
    botMessage: {
      type: 'review',
      text: missing.length
        ? `Review is available, but the following sections still need completion: ${missing.join(', ')}.`
        : 'Review complete. Before final submission, confirm that your answers are accurate and that you explicitly acknowledge the agreement.'
    }
  });
});

app.post('/api/agreement/submit', async (req, res) => {
  const { sessionId, finalConfirmation } = req.body || {};
  const session = await getSessionById(sessionId);

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
      session: summarizeSession(session)
    });
  }

  session.status = 'submitted';
  session.submitted_at = new Date().toISOString();
  session.review_complete = true;
  setEngagementStatus(session, 'agreement_completed', 'applicant');
  recordEvent(session, 'agreement_submitted', 'Agreement submitted; approval, payment verification, and access release remain separate steps.');
  await saveSession(session);

  return res.json({
    success: true,
    session: summarizeSession(session),
    botMessage: {
      type: 'submit',
      text: 'Agreement submitted successfully. This does not mean approval, payment verification, or access release has been granted.'
    }
  });
});

app.get('/api/dashboard/summary', async (req, res) => {
  const rows = await db.all(`
    SELECT engagement_status, status, COUNT(*) AS total
    FROM sessions
    GROUP BY engagement_status, status
  `);

  const summary = {
    totalSessions: 0,
    browsing_or_inquiry: 0,
    agreement_in_progress: 0,
    awaiting_payment: 0,
    agreement_completed: 0,
    submitted: 0
  };

  for (const row of rows) {
    summary.totalSessions += Number(row.total || 0);

    if (row.engagement_status === 'browsing_or_inquiry') summary.browsing_or_inquiry += Number(row.total || 0);
    if (row.engagement_status === 'agreement_in_progress') summary.agreement_in_progress += Number(row.total || 0);
    if (row.engagement_status === 'awaiting_payment') summary.awaiting_payment += Number(row.total || 0);
    if (row.engagement_status === 'agreement_completed') summary.agreement_completed += Number(row.total || 0);
    if (row.status === 'submitted') summary.submitted += Number(row.total || 0);
  }

  return res.json({
    summary,
    note: 'This is a prototype engagement summary. A real system should use authenticated applicant records and confirmed events only.'
  });
});

app.get('/api/sessions', async (req, res) => {
  const rows = await db.all('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 20');
  const sessions = rows.map((row) => ({
    ...summarizeSession({
      session_id: row.session_id,
      applicant_id: row.applicant_id,
      visitor_type: row.visitor_type,
      engagement_status: row.engagement_status,
      agreement_started: Boolean(row.agreement_started),
      current_section_index: Number(row.current_section_index || 0),
      status: row.status,
      submitted_at: row.submitted_at,
      review_complete: Boolean(row.review_complete),
      answers: parseJson(row.answers_json, {}),
      events: parseJson(row.events_json, []),
      completed_sections: parseJson(row.completed_sections_json, []),
      created_at: row.created_at,
      updated_at: row.updated_at
    })
  }));

  return res.json({ sessions });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  initDatabase()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Agreement chatbot prototype listening at http://localhost:${PORT}`);
        console.log(`SQLite database ready at ${path.join(__dirname, 'chatbot.db')}`);
      });
    })
    .catch((error) => {
      console.error('Failed to initialize database:', error);
      process.exit(1);
    });
}

module.exports = { app, initDatabase };
