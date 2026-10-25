const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function generateReply(message) {
  const text = message.toLowerCase().trim();

  if (!text) {
    return 'Please type a message so I can respond.';
  }

  if (text.includes('hello') || text.includes('hi')) {
    return 'Hello! How can I help you today?';
  }

  if (text.includes('how are you')) {
    return 'I am doing well and ready to help you chat!';
  }

  if (text.includes('time')) {
    return `The current server time is ${new Date().toLocaleTimeString()}.`;
  }

  if (text.includes('date')) {
    return `Today is ${new Date().toLocaleDateString()}.`;
  }

  if (text.includes('help')) {
    return 'Try asking for a greeting, the time, the date, or something like "tell me a joke".';
  }

  if (text.includes('joke')) {
    return 'Why do programmers prefer dark mode? Because light attracts bugs.';
  }

  if (text.includes('name')) {
    return 'I am a simple local chatbot built with Node.js and Express.';
  }

  if (text.includes('bye') || text.includes('goodbye')) {
    return 'Goodbye! Come back anytime.';
  }

  return `You said: "${message}". I am a basic chatbot, so I can respond to common greetings and simple questions.`;
}

app.post('/api/chat', (req, res) => {
  const { message } = req.body;

  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'Message must be a string.' });
  }

  const reply = generateReply(message);
  return res.json({ reply });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Chatbot app listening at http://localhost:${PORT}`);
});
