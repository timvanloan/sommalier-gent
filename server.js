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
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: SALESFORCE_CONSUMER_KEY,
    client_secret: SALESFORCE_CONSUMER_SECRET
  });

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

// API endpoint to get Agentforce agent response
app.post('/api/agentforce-chat', async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    
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

    // Try multiple API endpoint patterns
    try {
      // Method 1: Try Agentforce API endpoint (correct structure)
      // Create session first
      let sessionId = conversationId;
      if (!sessionId) {
        const sessionUrl = `${SALESFORCE_DOMAIN_URL}/services/data/v61.0/agentforce/agents/${SALESFORCE_AGENT_ID}/sessions`;
        const sessionUuid = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const sessionResponse = await fetch(sessionUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            bypassUser: true,
            sessionKey: sessionUuid
          })
        });

        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json();
          sessionId = sessionData.sessionId || sessionData.id;
          console.log('✅ Created conversation session:', sessionId);
        } else {
          const errorText = await sessionResponse.text();
          console.log('Session creation failed:', sessionResponse.status, errorText);
        }
      }

      // Method 2: Send message using Agentforce API
      if (sessionId) {
        const messageUrl = `${SALESFORCE_DOMAIN_URL}/services/data/v61.0/agentforce/agents/${SALESFORCE_AGENT_ID}/sessions/${sessionId}/messages`;
        
        const messageResponse = await fetch(messageUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            input: {
              text: message
            }
          })
        });

        if (messageResponse.ok) {
          const messageData = await messageResponse.json();
          console.log('Message sent, response:', JSON.stringify(messageData).substring(0, 200));
          
          // Agent response is typically in the same response
          if (messageData.output && messageData.output.text) {
            return res.json({ 
              response: messageData.output.text,
              conversationId: sessionId
            });
          }
          
          // Or it might be in a different field
          if (messageData.response || messageData.message || messageData.text) {
            return res.json({ 
              response: messageData.response || messageData.message || messageData.text,
              conversationId: sessionId
            });
          }
          
          // Wait and poll for response
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Get latest messages
          const messagesResponse = await fetch(messageUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          });

          if (messagesResponse.ok) {
            const messagesData = await messagesResponse.json();
            const messages = messagesData.records || messagesData.messages || messagesData || [];
            
            // Find the latest agent message
            let agentResponse = null;
            if (Array.isArray(messages)) {
              const agentMessages = messages
                .filter(m => (m.Sender__c === 'Agent' || m.sender === 'agent' || m.role === 'assistant' || m.type === 'agent'))
                .sort((a, b) => new Date(b.CreatedDate || b.createdDate || 0) - new Date(a.CreatedDate || a.createdDate || 0));
              
              if (agentMessages.length > 0) {
                agentResponse = agentMessages[0].Message__c || agentMessages[0].text || agentMessages[0].message || agentMessages[0].content || agentMessages[0].output?.text;
              }
            }
            
            if (agentResponse) {
              return res.json({ 
                response: agentResponse,
                conversationId: sessionId
              });
            }
          }
        } else {
          const errorText = await messageResponse.text();
          console.log('Message sending failed:', messageResponse.status, errorText);
        }
      }

      // Method 3: Try alternative endpoint structure
      const altUrl = `${SALESFORCE_DOMAIN_URL}/services/data/v61.0/agentforce/agents/${SALESFORCE_AGENT_ID}/chat`;
      const altResponse = await fetch(altUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: message,
          sessionId: conversationId
        })
      });

      if (altResponse.ok) {
        const altData = await altResponse.json();
        return res.json({ 
          response: altData.response || altData.message || altData.text || altData.output?.text,
          conversationId: altData.sessionId || conversationId
        });
      }

      // If all methods fail, return error with details
      return res.status(500).json({ 
        error: 'Unable to communicate with Agentforce API',
        details: 'Tried multiple API endpoints but none responded successfully',
        note: 'Please check Salesforce Agentforce API documentation. You may need to verify your Connected App is associated with the agent and has the correct OAuth scopes.'
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
