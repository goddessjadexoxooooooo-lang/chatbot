const form = document.getElementById('direct-form');
const statusBox = document.getElementById('statusBox');
const submitButton = document.getElementById('submitAgreement');
let applicationId = localStorage.getItem('agreementAppId') || null;

function showStatus(message, isError = false) {
  statusBox.style.display = 'block';
  statusBox.style.background = isError ? '#fee2e2' : '#eff6ff';
  statusBox.style.color = isError ? '#991b1b' : '#1e3a8a';
  statusBox.textContent = message;
}

async function ensureApplication() {
  if (applicationId) {
    const response = await fetch(`/api/applications/${applicationId}`);
    if (response.ok) return;
  }

  const response = await fetch('/api/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Unable to create application');
  }

  applicationId = data.application.id;
  localStorage.setItem('agreementAppId', applicationId);
}

async function saveField(key, value) {
  if (!applicationId) await ensureApplication();

  const response = await fetch(`/api/applications/${applicationId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Unable to save answer');
  }

  return data;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    await ensureApplication();

    const payload = {
      fullName: document.getElementById('fullName').value,
      email: document.getElementById('email').value,
      agreementAcknowledgement: document.getElementById('agreementAcknowledgement').value,
      signature: document.getElementById('signature').value,
    };

    for (const [key, value] of Object.entries(payload)) {
      await saveField(key, value);
    }

    showStatus('Agreement responses saved successfully.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

submitButton.addEventListener('click', async () => {
  try {
    await ensureApplication();
    const response = await fetch(`/api/applications/${applicationId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Unable to submit agreement');
    }

    showStatus(data.message || 'Agreement submitted successfully.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

ensureApplication().catch((error) => {
  showStatus(error.message, true);
});
