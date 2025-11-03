const express = require('express');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.CHATGPT_API_KEY
});

// Voice chat API endpoint
app.post('/api/voice-chat', async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Build conversation messages
    const messages = [
      {
        role: 'system',
        content: 'You are a sophisticated sommelier assistant for Sommalier Gent, a wine recommendation service. You help customers find the perfect wine based on their preferences, food pairings, and occasions. Be knowledgeable, elegant, and conversational. Keep responses concise for voice interactions.'
      },
      ...history,
      {
        role: 'user',
        content: message
      }
    ];

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: messages,
      temperature: 0.7,
      max_tokens: 300
    });

    const response = completion.choices[0].message.content;

    res.json({ response });
  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ error: 'Failed to process request', details: error.message });
  }
});

// Route for voice page
app.get('/voice', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'voice.html'));
});

// Default route serves main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
