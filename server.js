const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const OpenAI = require('openai');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.CHATGPT_API_KEY?.trim()
});

// Salesforce OAuth Token Cache
let salesforceAccessToken = null;
let tokenExpiryTime = null;

// Salesforce Configuration
const SALESFORCE_DOMAIN_URL = process.env.SALESFORCE_DOMAIN_URL?.trim() || 'https://storm-11c5bf736713cf.my.salesforce.com';
const SALESFORCE_CONSUMER_KEY = process.env.SALESFORCE_CONSUMER_KEY?.trim();
const SALESFORCE_CONSUMER_SECRET = process.env.SALESFORCE_CONSUMER_SECRET?.trim();
const SALESFORCE_AGENT_ID = process.env.SALESFORCE_AGENT_ID?.trim() || '00DHu00000izUN6';
// Optional: Username-Password flow (alternative to Client Credentials)
const SALESFORCE_USERNAME = process.env.SALESFORCE_USERNAME?.trim();
const SALESFORCE_PASSWORD = process.env.SALESFORCE_PASSWORD?.trim();
const SALESFORCE_SECURITY_TOKEN = process.env.SALESFORCE_SECURITY_TOKEN?.trim();

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const requestModule = urlObj.protocol === 'https:' ? https : http;
    
    const req = requestModule.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.end();
  });
}

// Get Salesforce OAuth Access Token
async function getSalesforceAccessToken() {
  // Check if we have a valid cached token
  if (salesforceAccessToken && tokenExpiryTime && Date.now() < tokenExpiryTime) {
    return salesforceAccessToken;
  }

  if (!SALESFORCE_CONSUMER_KEY || !SALESFORCE_CONSUMER_SECRET) {
    throw new Error('Salesforce credentials not configured. Please set SALESFORCE_CONSUMER_KEY and SALESFORCE_CONSUMER_SECRET environment variables.');
  }

  const tokenUrl = `${SALESFORCE_DOMAIN_URL}/services/oauth2/token`;
  
  // Try Client Credentials flow first
  let params;
  if (SALESFORCE_USERNAME && SALESFORCE_PASSWORD) {
    // Username-Password flow (alternative)
    const password = SALESFORCE_PASSWORD + (SALESFORCE_SECURITY_TOKEN ? SALESFORCE_SECURITY_TOKEN : '');
    params = new URLSearchParams({
      grant_type: 'password',
      client_id: SALESFORCE_CONSUMER_KEY,
      client_secret: SALESFORCE_CONSUMER_SECRET,
      username: SALESFORCE_USERNAME,
      password: password
    });
    console.log('Trying Username-Password OAuth flow...');
    console.log(`Username: ${SALESFORCE_USERNAME}`);
    console.log(`Password length: ${password.length} (has token: ${!!SALESFORCE_SECURITY_TOKEN})`);
    console.log(`Token URL: ${tokenUrl}`);
  } else {
    // Client Credentials flow
    params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: SALESFORCE_CONSUMER_KEY,
      client_secret: SALESFORCE_CONSUMER_SECRET
    });
    console.log('Trying Client Credentials OAuth flow...');
    console.log(`Token URL: ${tokenUrl}`);
    console.log(`Consumer Key: ${SALESFORCE_CONSUMER_KEY.substring(0, 20)}...`);
  }

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OAuth Error Details: Status ${response.status}`);
      console.error(`Error Response: ${errorText}`);
      try {
        const errorJson = JSON.parse(errorText);
        console.error(`Parsed Error: ${JSON.stringify(errorJson, null, 2)}`);
      } catch (e) {
        // Not JSON, that's okay
      }
      throw new Error(`OAuth token request failed: ${response.status} ${errorText}`);
    }

    const tokenData = await response.json();
    salesforceAccessToken = tokenData.access_token;
    // Set expiry time (usually expires in 2 hours, use 1.5 hours for safety)
    tokenExpiryTime = Date.now() + (tokenData.expires_in - 1800) * 1000;
    
    console.log('✅ Salesforce OAuth token obtained successfully');
    return salesforceAccessToken;
  } catch (error) {
    console.error('❌ Error getting Salesforce access token:', error);
    throw error;
  }
}

// Create Agentforce conversation session
async function createConversationSession(accessToken) {
  const apiUrl = `${SALESFORCE_DOMAIN_URL}/services/data/v61.0/sobjects/AgentforceConversation__c`;
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        AgentforceAgent__c: SALESFORCE_AGENT_ID
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create conversation: ${response.status} ${errorText}`);
    }

    const sessionData = await response.json();
    return sessionData.id; // Conversation session ID
  } catch (error) {
    console.error('Error creating conversation session:', error);
    throw error;
  }
}

// Send message to Agentforce agent
async function sendMessageToAgent(accessToken, conversationId, message) {
  // Try Agentforce API endpoint
  const apiUrl = `${SALESFORCE_DOMAIN_URL}/services/data/v61.0/sobjects/AgentforceMessage__c`;
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        Conversation__c: conversationId,
        Message__c: message,
        Sender__c: 'User'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      // If this endpoint doesn't work, try alternative API
      console.log('Standard API failed, trying alternative...');
      return await sendMessageToAgentAlternative(accessToken, conversationId, message);
    }

    const messageData = await response.json();
    return messageData;
  } catch (error) {
    console.error('Error sending message:', error);
    return await sendMessageToAgentAlternative(accessToken, conversationId, message);
  }
}

// Alternative method using Agentforce REST API
async function sendMessageToAgentAlternative(accessToken, conversationId, message) {
  // Try the Agentforce API endpoint
  const apiUrl = `${SALESFORCE_DOMAIN_URL}/services/data/v61.0/chatbot/agents/${SALESFORCE_AGENT_ID}/sessions/${conversationId}/messages`;
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: message
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send message: ${response.status} ${errorText}`);
    }

    const responseData = await response.json();
    return responseData;
  } catch (error) {
    console.error('Alternative API also failed:', error);
    throw error;
  }
}

// Get agent response
async function getAgentResponse(accessToken, conversationId) {
  // Poll for response
  const apiUrl = `${SALESFORCE_DOMAIN_URL}/services/data/v61.0/chatbot/agents/${SALESFORCE_AGENT_ID}/sessions/${conversationId}/messages`;
  
  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get response: ${response.status} ${errorText}`);
    }

    const messages = await response.json();
    // Get the last message from the agent
    const agentMessages = messages.records || messages || [];
    const lastAgentMessage = Array.isArray(agentMessages) 
      ? agentMessages.filter(m => m.Sender__c === 'Agent' || m.sender === 'agent').pop()
      : null;
    
    return lastAgentMessage?.Message__c || lastAgentMessage?.text || lastAgentMessage?.message || null;
  } catch (error) {
    console.error('Error getting agent response:', error);
    throw error;
  }
}

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

// Route for voice-agent page
app.get('/voice-agent', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'voice-agent.html'));
});

// API endpoint to initialize an Agentforce session and get the agent's opening message
app.post('/api/agentforce-init', async (req, res) => {
  try {
    if (!SALESFORCE_CONSUMER_KEY || !SALESFORCE_CONSUMER_SECRET) {
      return res.status(500).json({ error: 'Salesforce credentials not configured' });
    }

    let accessToken;
    try {
      accessToken = await getSalesforceAccessToken();
    } catch (error) {
      return res.status(500).json({ error: 'Salesforce authentication failed', details: error.message });
    }

    const API_VERSION = 'v62.0';
    const sessionUrl = `${SALESFORCE_DOMAIN_URL}/services/data/${API_VERSION}/agentforce/agents/${SALESFORCE_AGENT_ID}/sessions`;
    const externalSessionKey = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

    const sessionResponse = await fetch(sessionUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalSessionKey, instanceConfig: { endpoint: SALESFORCE_DOMAIN_URL } })
    });

    const sessionText = await sessionResponse.text();
    console.log('Init session response:', sessionResponse.status, sessionText.substring(0, 500));

    if (!sessionResponse.ok) {
      return res.status(500).json({ error: 'Failed to create session', details: sessionText });
    }

    const sessionData = JSON.parse(sessionText);
    const sessionId = sessionData.sessionId || sessionData.id;

    // Check if session creation returned initial messages
    const initMessages = sessionData.messages || [];
    const initTexts = initMessages.filter(m => m.type === 'Text' && m.text).map(m => m.text);

    if (initTexts.length > 0) {
      return res.json({ sessionId, greeting: initTexts.join(' ') });
    }

    // No initial message returned — send a greeting trigger to get the agent's opening
    const messageUrl = `${SALESFORCE_DOMAIN_URL}/services/data/${API_VERSION}/agentforce/agents/${SALESFORCE_AGENT_ID}/sessions/${sessionId}/messages`;
    const greetResponse = await fetch(messageUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { sequenceId: 1, type: 'Text', text: 'Hello' }, variables: [] })
    });

    if (greetResponse.ok) {
      const greetData = await greetResponse.json();
      const greetTexts = (greetData.messages || []).filter(m => m.type === 'Text' && m.text).map(m => m.text);
      return res.json({ sessionId, greeting: greetTexts.join(' ') || null });
    }

    return res.json({ sessionId, greeting: null });

  } catch (error) {
    console.error('Init error:', error);
    res.status(500).json({ error: 'Failed to initialize agent', details: error.message });
  }
});

// API endpoint to get Agentforce agent response
app.post('/api/agentforce-chat', async (req, res) => {
  try {
    const { message, conversationId, sequenceId } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check if credentials are configured
    if (!SALESFORCE_CONSUMER_KEY || !SALESFORCE_CONSUMER_SECRET) {
      return res.status(500).json({ 
        error: 'Salesforce credentials not configured',
        details: 'Please set SALESFORCE_CONSUMER_KEY and SALESFORCE_CONSUMER_SECRET in Heroku Config Vars',
        note: 'You need to create a Connected App in Salesforce and get the Consumer Key and Secret'
      });
    }

    // Get access token
    let accessToken;
    try {
      accessToken = await getSalesforceAccessToken();
    } catch (error) {
      console.error('Authentication failed:', error);
      return res.status(500).json({ 
        error: 'Salesforce authentication failed',
        details: error.message,
        note: 'Please verify your SALESFORCE_CONSUMER_KEY and SALESFORCE_CONSUMER_SECRET are correct'
      });
    }

    try {
      const API_VERSION = 'v62.0';

      // Step 1: Create session if we don't have one
      let sessionId = conversationId;
      let sequenceId = 1;

      if (!sessionId) {
        const sessionUrl = `${SALESFORCE_DOMAIN_URL}/services/data/${API_VERSION}/agentforce/agents/${SALESFORCE_AGENT_ID}/sessions`;
        const externalSessionKey = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });

        const sessionResponse = await fetch(sessionUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            externalSessionKey,
            instanceConfig: {
              endpoint: SALESFORCE_DOMAIN_URL
            }
          })
        });

        const sessionText = await sessionResponse.text();
        console.log('Session response:', sessionResponse.status, sessionText.substring(0, 300));

        if (sessionResponse.ok) {
          const sessionData = JSON.parse(sessionText);
          sessionId = sessionData.sessionId || sessionData.id;
          console.log('✅ Created session:', sessionId);
        } else {
          console.log('Session creation failed:', sessionResponse.status, sessionText);
          return res.status(500).json({
            error: 'Unable to communicate with Agentforce API',
            details: `Session creation failed: ${sessionResponse.status} ${sessionText}`
          });
        }
      }

      // Step 2: Send message
      const messageUrl = `${SALESFORCE_DOMAIN_URL}/services/data/${API_VERSION}/agentforce/agents/${SALESFORCE_AGENT_ID}/sessions/${sessionId}/messages`;
      const msgSeqId = sequenceId || 1;

      const messageResponse = await fetch(messageUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: {
            sequenceId: msgSeqId,
            type: 'Text',
            text: message
          },
          variables: []
        })
      });

      const messageText = await messageResponse.text();
      console.log('Message response:', messageResponse.status, messageText.substring(0, 500));

      if (!messageResponse.ok) {
        return res.status(500).json({
          error: 'Unable to communicate with Agentforce API',
          details: `Message failed: ${messageResponse.status} ${messageText}`
        });
      }

      const messageData = JSON.parse(messageText);

      // Extract agent reply from messages array
      const messages = messageData.messages || [];
      const agentTexts = messages
        .filter(m => m.type === 'Text' && m.text)
        .map(m => m.text);

      const agentReply = agentTexts.join(' ').trim();

      if (agentReply) {
        return res.json({ response: agentReply, conversationId: sessionId });
      }

      // Log full response for debugging if no text found
      console.log('Full message response:', JSON.stringify(messageData));
      return res.status(500).json({
        error: 'Unable to communicate with Agentforce API',
        details: 'Agent returned no text response',
        raw: messageData
      });

    } catch (error) {
      console.error('Error communicating with agent:', error);
      return res.status(500).json({
        error: 'Failed to communicate with agent',
        details: error.message
      });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to process request', details: error.message });
  }
});

// OpenAI TTS endpoint for voice synthesis
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const ttsVoice = voice || 'alloy';
    
    const ttsVoice = voice || 'alloy';
    
    // Use OpenAI TTS API
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1-hd',
      voice: ttsVoice,
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
