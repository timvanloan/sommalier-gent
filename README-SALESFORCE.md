# Sommalier Voice Agent - Salesforce Experience Cloud Deployment

This branch contains Salesforce-specific code for deploying the voice agent as a Lightning Web Component on a Salesforce Experience Cloud site.

## Files Structure

```
force-app/
├── main/
│   └── default/
│       ├── classes/
│       │   ├── SommalierVoiceAgentController.cls          # Apex REST controller for Agentforce API
│       │   ├── SommalierVoiceAgentController.cls-meta.xml
│       │   ├── SommalierTTSService.cls                     # Text-to-Speech service (optional)
│       │   └── SommalierTTSService.cls-meta.xml
│       └── lwc/
│           └── sommalierVoiceAgent/
│               ├── sommalierVoiceAgent.js                  # LWC JavaScript
│               ├── sommalierVoiceAgent.html                # LWC Template
│               ├── sommalierVoiceAgent.css                 # LWC Styles
│               └── sommalierVoiceAgent.js-meta.xml         # LWC Metadata
```

## Setup Instructions

### 1. Deploy to Salesforce

```bash
# Login to Salesforce
sf login org web --alias sommalier

# Deploy the code
sf project deploy start
```

### 2. Add Component to Experience Cloud Site

**Note**: The Apex code uses the current user's session for authentication, so no Named Credentials are required! The component automatically authenticates using the logged-in user's session.

1. **Experience Builder → Your Site → Pages**
2. **Add → Custom → Lightning Components**
3. Search for `sommalierVoiceAgent`
4. Drag it onto the page
5. **Publish** the site

### 4. Update Agent ID (if needed)

If your Agent ID is different, update it in `SommalierVoiceAgentController.cls`:

```apex
private static final String AGENT_ID = '00DHu00000izUN6';
```

## Features

- ✅ Voice input using Web Speech API
- ✅ Agentforce API integration via Apex
- ✅ Text-to-Speech using browser Speech Synthesis API
- ✅ Conversation history display
- ✅ Real-time transcript preview
- ✅ Visual status indicators

## API Endpoint

The component uses the Apex REST endpoint:
- **URL**: `/services/apexrest/sommalier-voice-chat/`
- **Method**: POST
- **Request Body**:
  ```json
  {
    "message": "User message text",
    "conversationId": "optional-session-id"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "conversationId": "session-id",
    "response": "Agent response text"
  }
  ```

## Notes

- The component uses browser-based Speech Recognition and Speech Synthesis APIs
- No external API keys required (unlike Heroku deployment)
- No Named Credentials needed - uses current user's session automatically
- Runs entirely within Salesforce's secure environment
- Automatically handles authentication using the logged-in user's session token

