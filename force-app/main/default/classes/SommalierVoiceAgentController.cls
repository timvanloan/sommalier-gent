/**
 * Apex REST Controller for Sommalier Voice Agent
 * Handles Agentforce API integration for voice chat
 */
@RestResource(urlMapping='/sommalier-voice-chat/*')
global class SommalierVoiceAgentController {
    
    // Agent ID from configuration
    private static final String AGENT_ID = '00DHu00000izUN6';
    
    /**
     * POST endpoint to send message to Agentforce agent
     */
    @HttpPost
    global static ResponseWrapper chat() {
        try {
            RestRequest req = RestContext.request;
            RequestWrapper requestData = (RequestWrapper) JSON.deserialize(
                req.requestBody.toString(), 
                RequestWrapper.class
            );
            
            if (String.isBlank(requestData.message)) {
                return new ResponseWrapper(false, 'Message is required', null, null);
            }
            
            // Get or create session
            String sessionId = requestData.conversationId;
            if (String.isBlank(sessionId)) {
                sessionId = createSession();
            }
            
            if (String.isBlank(sessionId)) {
                return new ResponseWrapper(false, 'Failed to create session', null, null);
            }
            
            // Send message to agent
            String response = sendMessage(sessionId, requestData.message);
            
            if (String.isBlank(response)) {
                return new ResponseWrapper(false, 'No response from agent', sessionId, null);
            }
            
            return new ResponseWrapper(true, null, sessionId, response);
            
        } catch (Exception e) {
            System.debug('Error in chat: ' + e.getMessage());
            System.debug('Stack trace: ' + e.getStackTraceString());
            return new ResponseWrapper(false, e.getMessage(), null, null);
        }
    }
    
    /**
     * Create a new Agentforce conversation session
     * Uses current user's session (no Named Credential required)
     */
    private static String createSession() {
        try {
            String sessionUuid = 'session-' + DateTime.now().getTime() + '-' + 
                                  String.valueOf(Math.random()).substring(2, 11);
            
            // Get the current user's session ID
            String sessionId = UserInfo.getSessionId();
            String orgDomain = URL.getOrgDomainUrl().toExternalForm();
            
            HttpRequest req = new HttpRequest();
            req.setEndpoint(orgDomain + '/services/data/v61.0/agentforce/agents/' + 
                           AGENT_ID + '/sessions');
            req.setMethod('POST');
            req.setHeader('Authorization', 'Bearer ' + sessionId);
            req.setHeader('Content-Type', 'application/json');
            req.setBody(JSON.serialize(new Map<String, Object>{
                'bypassUser' => true,
                'sessionKey' => sessionUuid
            }));
            
            Http http = new Http();
            HttpResponse res = http.send(req);
            
            if (res.getStatusCode() == 200 || res.getStatusCode() == 201) {
                Map<String, Object> responseData = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
                return (String) responseData.get('sessionId');
            } else {
                System.debug('Session creation failed: ' + res.getStatusCode() + ' ' + res.getBody());
                return null;
            }
            
        } catch (Exception e) {
            System.debug('Error creating session: ' + e.getMessage());
            System.debug('Stack trace: ' + e.getStackTraceString());
            return null;
        }
    }
    
    /**
     * Send message to Agentforce agent and get response
     * Uses current user's session (no Named Credential required)
     */
    private static String sendMessage(String sessionId, String message) {
        try {
            String userSessionId = UserInfo.getSessionId();
            String orgDomain = URL.getOrgDomainUrl().toExternalForm();
            
            // Send message
            HttpRequest req = new HttpRequest();
            req.setEndpoint(orgDomain + '/services/data/v61.0/agentforce/agents/' + 
                           AGENT_ID + '/sessions/' + sessionId + '/messages');
            req.setMethod('POST');
            req.setHeader('Authorization', 'Bearer ' + userSessionId);
            req.setHeader('Content-Type', 'application/json');
            req.setBody(JSON.serialize(new Map<String, Object>{
                'text' => message
            }));
            
            Http http = new Http();
            HttpResponse res = http.send(req);
            
            if (res.getStatusCode() != 200 && res.getStatusCode() != 201) {
                System.debug('Message send failed: ' + res.getStatusCode() + ' ' + res.getBody());
                return null;
            }
            
            // Poll for response
            String response = pollForResponse(sessionId);
            return response;
            
        } catch (Exception e) {
            System.debug('Error sending message: ' + e.getMessage());
            System.debug('Stack trace: ' + e.getStackTraceString());
            return null;
        }
    }
    
    /**
     * Poll for agent response
     * Uses current user's session (no Named Credential required)
     */
    private static String pollForResponse(String sessionId) {
        Integer maxAttempts = 30; // 30 seconds max
        Integer attempt = 0;
        String userSessionId = UserInfo.getSessionId();
        String orgDomain = URL.getOrgDomainUrl().toExternalForm();
        
        while (attempt < maxAttempts) {
            try {
                HttpRequest req = new HttpRequest();
                req.setEndpoint(orgDomain + '/services/data/v61.0/agentforce/agents/' + 
                               AGENT_ID + '/sessions/' + sessionId + '/messages');
                req.setMethod('GET');
                req.setHeader('Authorization', 'Bearer ' + userSessionId);
                
                Http http = new Http();
                HttpResponse res = http.send(req);
                
                if (res.getStatusCode() == 200) {
                    List<Object> messages = (List<Object>) JSON.deserializeUntyped(res.getBody());
                    
                    // Find the last assistant message
                    for (Integer i = messages.size() - 1; i >= 0; i--) {
                        Map<String, Object> msg = (Map<String, Object>) messages[i];
                        String role = (String) msg.get('role');
                        if (role == 'assistant' || role == 'agent') {
                            String text = (String) msg.get('text');
                            if (String.isNotBlank(text)) {
                                return text;
                            }
                        }
                    }
                }
                
                // Wait before next poll
                attempt++;
                if (attempt < maxAttempts) {
                    // Use a simple delay mechanism
                    Long startTime = DateTime.now().getTime();
                    while (DateTime.now().getTime() - startTime < 1000) {
                        // Wait 1 second
                    }
                }
                
            } catch (Exception e) {
                System.debug('Error polling response: ' + e.getMessage());
                attempt++;
            }
        }
        
        return null;
    }
    
    /**
     * Request wrapper class
     */
    global class RequestWrapper {
        public String message;
        public String conversationId;
    }
    
    /**
     * Response wrapper class
     */
    global class ResponseWrapper {
        public Boolean success;
        public String error;
        public String conversationId;
        public String response;
        
        public ResponseWrapper(Boolean success, String error, String conversationId, String response) {
            this.success = success;
            this.error = error;
            this.conversationId = conversationId;
            this.response = response;
        }
    }
}

