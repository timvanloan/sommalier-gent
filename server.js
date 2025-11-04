const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.CHATGPT_API_KEY?.trim()
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

// Route for voice2 page
app.get('/voice2', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'voice2.html'));
});

// Route for voice3 page
app.get('/voice3', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'voice3.html'));
});

// API endpoint to get Agentforce agent response
// Note: This is a placeholder - you'll need to integrate with Salesforce Agentforce API
app.post('/api/agentforce-chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // TODO: Integrate with Salesforce Agentforce API here
    // For now, return a placeholder response indicating manual interaction is needed
    // In a real implementation, you would:
    // 1. Authenticate with Salesforce
    // 2. Call Agentforce API endpoints
    // 3. Get the agent's response
    // 4. Return it to the client
    
    res.json({ 
      message: 'Agentforce API integration needed',
      received: message,
      note: 'Please integrate with Salesforce Agentforce REST API to enable programmatic messaging'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to process request', details: error.message });
  }
});

// OpenAI TTS endpoint for voice synthesis
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }
    
    // Use OpenAI TTS API
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'alloy',
      input: text,
    });
    
    const buffer = Buffer.from(await mp3.arrayBuffer());
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ error: 'Failed to generate speech', details: error.message });
  }
});

// OpenAI transcription endpoint for speech-to-text
app.post('/api/transcribe', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    if (!req.body || !req.body.audio) {
      return res.status(400).json({ error: 'Audio data is required' });
    }
    
    // Decode base64 audio
    const audioBuffer = Buffer.from(req.body.audio, 'base64');
    
    // Create a File-like object for OpenAI using the File-like approach
    // OpenAI expects a File object, but in Node.js we need to use a workaround
    
    // Create temporary file
    const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.webm`);
    fs.writeFileSync(tempFilePath, audioBuffer);
    
    try {
      // Create a File object for OpenAI (using fs.createReadStream)
      const fileStream = fs.createReadStream(tempFilePath);
      
      // Use OpenAI's File.create method or pass the stream directly
      const transcription = await openai.audio.transcriptions.create({
        file: fileStream,
        model: 'whisper-1',
        language: 'en'
      });
      
      // Clean up temp file
      fs.unlinkSync(tempFilePath);
      
      res.json({ text: transcription.text });
    } catch (transcribeError) {
      // Clean up temp file on error
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      throw transcribeError;
    }
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Failed to transcribe audio', details: error.message });
  }
});

// Default route serves main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
