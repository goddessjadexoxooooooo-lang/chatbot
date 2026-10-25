const chatForm = document.getElementById('chat-form');
const chatWindow = document.getElementById('chat-window');
const messageInput = document.getElementById('message-input');
const applicationIdEl = document.getElementById('application-id');
const progressTextEl = document.getElementById('progress-text');
const applicationStatusEl = document.getElementById('application-status');

const storageKey = 'agreementAppId';

function addMessage(text, sender) {
  const messageEl = document.createElement('div');
  messageEl.className = `message ${sender}`;
  messageEl.textContent = text;
  chatWindow.appendChild(messageEl);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function updateProgress(data) {
  if (!data || !data.progress) return;

  const { answered, total } = data.progress;
  progressTextEl.textContent = `${answered} / ${total} complete`;
  applicationStatusEl.textContent = data.status || 'In progress';

  const appId = localStorage.getItem(storageKey);
  if (appId) {
    applicationIdEl.textContent = appId.slice(0, 8);
  }
}

async function startApplicationIfNeeded() {
  let applicationId = localStorage.getItem(storageKey);

  if (!applicationId) {
    const response = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to start application');

    localStorage.setItem(storageKey, data.application.id);
    applicationIdEl.textContent = data.application.id.slice(0, 8);
    addMessage(`We are beginning the agreement walkthrough. ${data.currentStep ? data.currentStep.question : 'Please review your answers.'}`, 'bot');
    updateProgress(data);
    return;
  }

  const response = await fetch(`/api/applications/${applicationId}`);
  const data = await response.json();
  if (!response.ok) {
    localStorage.removeItem(storageKey);
    return startApplicationIfNeeded();
  }

  updateProgress(data);
}

async function sendMessage(event) {
  event.preventDefault();

  const message = messageInput.value.trim();
  if (!message) return;

  const applicationId = localStorage.getItem(storageKey);
  addMessage(message, 'user');
  messageInput.value = '';

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        applicationId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Something went wrong');
    }

    if (data.applicationId) {
      localStorage.setItem(storageKey, data.applicationId);
      applicationIdEl.textContent = data.applicationId.slice(0, 8);
    }

    addMessage(data.reply, 'bot');
    updateProgress(data);
  } catch (error) {
    addMessage('Sorry, something went wrong. Please try again.', 'bot');
    console.error(error);
  }
}

chatForm.addEventListener('submit', sendMessage);
startApplicationIfNeeded().catch((error) => {
  addMessage('I could not start the agreement walkthrough. Please refresh and try again.', 'bot');
  console.error(error);
});
