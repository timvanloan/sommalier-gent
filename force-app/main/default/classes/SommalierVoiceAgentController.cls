/**
 * Apex Controller for Sommalier Voice Agent
 * Handles Agentforce API integration for voice chat
 */
public class SommalierVoiceAgentController {
    
    // Agent ID from configuration
    private static final String AGENT_ID = '00DHu00000izUN6';
    
    /**
     * AuraEnabled method to send message to Agentforce agent
     * Works with Experience Cloud sites
     */
    @AuraEnabled(cacheable=false)
    public static ChatResponse chat(String message, String conversationId) {
        try {
            if (String.isBlank(message)) {
                return new ChatResponse(false, 'Message is required', null, null);
            }
            
            // Get or create session
            String sessionId = conversationId;
            if (String.isBlank(sessionId)) {
                String sessionResult = createSession();
                if (String.isBlank(sessionResult)) {
                    return new ChatResponse(false, 'Failed to create session. Check debug logs for details.', null, null);
                }
                sessionId = sessionResult;
            }
            
            // Send message to agent
            String response = sendMessage(sessionId, message);
            
            if (String.isBlank(response)) {
                return new ChatResponse(false, 'No response from agent after polling', sessionId, null);
            }
            
            return new ChatResponse(true, null, sessionId, response);
            
        } catch (Exception e) {
            System.debug('Error in chat: ' + e.getMessage());
            System.debug('Stack trace: ' + e.getStackTraceString());
            return new ChatResponse(false, 'Error: ' + e.getMessage() + ' (Check debug logs)', null, null);
        }
    }
    
    /**
     * Create a new Agentforce conversation session
     * Uses current user's session ID from the request context
     */
    private static String createSession() {
        try {
            String sessionUuid = 'session-' + DateTime.now().getTime() + '-' + 
                                  String.valueOf(Math.random()).substring(2, 11);
            
            // Get the current user's session ID
            String userSessionId = UserInfo.getSessionId();
            String orgDomain = URL.getOrgDomainUrl().toExternalForm();
            
            // Build the endpoint URL
            String endpoint = orgDomain + '/services/data/v61.0/agentforce/agents/' + 
                             AGENT_ID + '/sessions';
            
            System.debug('Creating session with endpoint: ' + endpoint);
            System.debug('Session ID length: ' + (userSessionId != null ? userSessionId.length() : 0));
            
            HttpRequest req = new HttpRequest();
            req.setEndpoint(endpoint);
            req.setMethod('POST');
            req.setHeader('Authorization', 'Bearer ' + userSessionId);
            req.setHeader('Content-Type', 'application/json');
            req.setTimeout(30000); // 30 second timeout
            req.setBody(JSON.serialize(new Map<String, Object>{
                'bypassUser' => true,
                'sessionKey' => sessionUuid
            }));
            
            Http http = new Http();
            HttpResponse res = http.send(req);
            
            System.debug('Session creation response status: ' + res.getStatusCode());
            System.debug('Session creation response body: ' + res.getBody());
            
            if (res.getStatusCode() == 200 || res.getStatusCode() == 201) {
                Map<String, Object> responseData = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
                String agentSessionId = (String) responseData.get('sessionId');
                System.debug('Created session ID: ' + agentSessionId);
                return agentSessionId;
            } else {
                System.debug('Session creation failed: ' + res.getStatusCode() + ' ' + res.getBody());
                System.debug('Response headers: ' + res.getHeaderKeys());
                return null;
            }
            
        } catch (Exception e) {
            System.debug('Error creating session: ' + e.getMessage());
            System.debug('Stack trace: ' + e.getStackTraceString());
            System.debug('Exception type: ' + e.getTypeName());
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
     * Response wrapper class for AuraEnabled
     */
    public class ChatResponse {
        @AuraEnabled public Boolean success;
        @AuraEnabled public String error;
        @AuraEnabled public String conversationId;
        @AuraEnabled public String response;
        
        public ChatResponse(Boolean success, String error, String conversationId, String response) {
            this.success = success;
            this.error = error;
            this.conversationId = conversationId;
            this.response = response;
        }
    }
}

