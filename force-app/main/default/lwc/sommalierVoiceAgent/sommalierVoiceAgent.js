import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class SommalierVoiceAgent extends LightningElement {
    @track conversationHistory = [];
    @track isListening = false;
    @track isProcessing = false;
    @track isSpeaking = false;
    @track statusText = 'Click to start speaking';
    @track transcriptPreview = '';
    
    recognition = null;
    synthesis = null;
    embeddedMessaging = null;
    lastMessageCount = 0;
    monitoringInterval = null;
    lastProcessedMessage = null;
    messagingReady = false;
    
    connectedCallback() {
        this.initializeSpeechRecognition();
        this.initializeSpeechSynthesis();
        this.initializeEmbeddedMessaging();
    }
    
    initializeEmbeddedMessaging() {
        // Don't initialize embedded messaging - use existing instance on page
        // Wait for existing embedded messaging to be ready
        const checkForExistingMessaging = () => {
            // Check if embedded messaging is already initialized
            if (window.embeddedservice_bootstrap && window.embeddedservice_bootstrap.utilAPI) {
                this.embeddedMessaging = window.embeddedservice_bootstrap.utilAPI;
                console.log('Found existing Embedded Messaging API');
                // Don't mark as ready yet - wait for the event
            }
            
            // Check if sidebar exists (indicates messaging is initialized)
            const sidebar = document.querySelector('.embeddedServiceSidebar');
            if (sidebar && !this.monitoringInterval) {
                console.log('Found existing Embedded Messaging sidebar');
                this.startMonitoringMessages();
            }
            
            // Check again after delay if not ready
            if (!this.messagingReady) {
                setTimeout(checkForExistingMessaging, 500);
            }
        };
        
        // Listen for ready event - this is the key!
        window.addEventListener('onEmbeddedMessagingReady', () => {
            console.log('onEmbeddedMessagingReady event fired');
            this.messagingReady = true;
            if (window.embeddedservice_bootstrap && window.embeddedservice_bootstrap.utilAPI) {
                this.embeddedMessaging = window.embeddedservice_bootstrap.utilAPI;
                console.log('Embedded Messaging API is ready');
            }
            this.startMonitoringMessages();
        });
        
        // Start checking
        checkForExistingMessaging();
    }
    
    startMonitoringMessages() {
        // Only start monitoring if not already started
        if (this.monitoringInterval) {
            return;
        }
        
        // Monitor the embedded messaging sidebar for new messages
        this.monitoringInterval = setInterval(() => {
            try {
                const sidebar = document.querySelector('.embeddedServiceSidebar');
                if (sidebar) {
                    // Try multiple selectors for messages
                    const messageSelectors = [
                        '.cuf-message',
                        '.message',
                        '[data-message-id]',
                        '.chat-message'
                    ];
                    
                    let messages = [];
                    for (const selector of messageSelectors) {
                        messages = sidebar.querySelectorAll(selector);
                        if (messages.length > 0) break;
                    }
                    
                    if (messages.length > this.lastMessageCount) {
                        // New message detected
                        const lastMessage = messages[messages.length - 1];
                        const messageText = lastMessage.textContent || lastMessage.innerText;
                        
                        // Check if it's from the agent (not user)
                        // Look for various indicators that it's an agent message
                        const isUserMessage = lastMessage.classList.contains('cuf-message-from-user') ||
                                           lastMessage.classList.contains('message-from-user') ||
                                           lastMessage.getAttribute('data-sender') === 'user' ||
                                           lastMessage.querySelector('.cuf-message-from-user');
                        
                        const isAgentMessage = !isUserMessage && 
                                             (lastMessage.classList.contains('cuf-message-from-agent') ||
                                              lastMessage.classList.contains('message-from-agent') ||
                                              lastMessage.getAttribute('data-sender') === 'agent' ||
                                              lastMessage.querySelector('.cuf-message-from-agent') ||
                                              messageText.length > 10); // Fallback: assume agent if substantial text
                        
                        if (isAgentMessage && messageText && messageText.trim()) {
                            const trimmedText = messageText.trim();
                            // Avoid processing the same message twice
                            if (trimmedText.length > 0 && (!this.lastProcessedMessage || this.lastProcessedMessage !== trimmedText)) {
                                this.lastMessageCount = messages.length;
                                this.lastProcessedMessage = trimmedText;
                                this.handleAgentResponse(trimmedText);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error monitoring messages:', error);
            }
        }, 1000);
    }
    
    handleAgentResponse(text) {
        // Only process if we're waiting for a response
        if (this.isProcessing) {
            this.addMessage('assistant', text);
            this.speak(text);
        }
    }
    
    initializeSpeechRecognition() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';
            
            this.recognition.onstart = () => {
                this.isListening = true;
                this.statusText = 'Listening...';
                this.updateUI('listening');
            };
            
            this.recognition.onresult = (event) => {
                let interimTranscript = '';
                let finalTranscript = '';
                
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript + ' ';
                    } else {
                        interimTranscript += transcript;
                    }
                }
                
                if (interimTranscript) {
                    this.transcriptPreview = interimTranscript;
                }
                
                if (finalTranscript) {
                    const userMessage = finalTranscript.trim();
                    this.addMessage('user', userMessage);
                    this.sendToAgent(userMessage);
                }
            };
            
            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                this.isListening = false;
                this.statusText = 'Error: ' + event.error;
                this.updateUI('idle');
                this.showToast('Error', event.error, 'error');
            };
            
            this.recognition.onend = () => {
                this.isListening = false;
                if (!this.isProcessing) {
                    this.updateUI('idle');
                    this.statusText = 'Click to speak again';
                }
            };
        }
    }
    
    initializeSpeechSynthesis() {
        if ('speechSynthesis' in window) {
            this.synthesis = window.speechSynthesis;
        }
    }
    
    handleVoiceClick() {
        if (this.isProcessing) {
            return;
        }
        
        if (this.isListening) {
            this.stopListening();
        } else {
            this.startListening();
        }
    }
    
    startListening() {
        if (this.recognition) {
            this.recognition.start();
        } else {
            this.showToast('Error', 'Speech recognition not supported', 'error');
        }
    }
    
    stopListening() {
        if (this.recognition) {
            this.recognition.stop();
        }
        this.isListening = false;
        this.updateUI('idle');
        this.statusText = 'Stopped';
    }
    
    async sendToAgent(userMessage) {
        this.isProcessing = true;
        this.updateUI('processing');
        this.statusText = 'Sending to agent...';
        this.transcriptPreview = '';
        
        try {
            // First, try to open the chat if it's not already open
            // Look for the chat launcher button first
            const launcherButton = document.querySelector('.embeddedServiceHelpButton, button[aria-label*="Chat"], .cuf-launcher-button');
            if (launcherButton && launcherButton.offsetParent !== null) {
                // Button is visible, click it to open chat
                console.log('Found chat launcher button, clicking to open chat');
                launcherButton.click();
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Try to find and interact with the chat input field
            // Try multiple selectors individually
            const selectors = [
                '.cuf-input textarea',
                'textarea[placeholder*="message" i]',
                'textarea[placeholder*="Type" i]',
                'textarea[aria-label*="message" i]',
                'textarea.cuf-input',
                '.embeddedServiceSidebar textarea',
                'textarea',
                'input[type="text"][placeholder*="message" i]'
            ];
            
            let chatInput = null;
            let attempts = 0;
            const maxAttempts = 10;
            
            // Keep trying to find the input with increasing delays
            while (!chatInput && attempts < maxAttempts) {
                for (const selector of selectors) {
                    // Try to find within the sidebar first
                    const sidebar = document.querySelector('.embeddedServiceSidebar');
                    if (sidebar) {
                        chatInput = sidebar.querySelector(selector);
                    }
                    if (!chatInput) {
                        chatInput = document.querySelector(selector);
                    }
                    if (chatInput && chatInput.offsetParent !== null) {
                        // Element is visible
                        break;
                    } else if (chatInput) {
                        // Element exists but might be hidden, keep it
                        break;
                    }
                }
                
                if (!chatInput) {
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    break;
                }
            }
            
            // If still not found and API is ready, try to launch chat
            if (!chatInput && this.messagingReady && this.embeddedMessaging && this.embeddedMessaging.launchChat) {
                try {
                    console.log('Attempting to launch chat via API');
                    this.embeddedMessaging.launchChat();
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Try finding input again
                    for (const selector of selectors) {
                        const sidebar = document.querySelector('.embeddedServiceSidebar');
                        if (sidebar) {
                            chatInput = sidebar.querySelector(selector);
                        }
                        if (!chatInput) {
                            chatInput = document.querySelector(selector);
                        }
                        if (chatInput) break;
                    }
                } catch (apiError) {
                    console.warn('Could not launch chat via API:', apiError);
                }
            }
            
            if (chatInput) {
                console.log('Found chat input, sending message');
                
                // Scroll into view
                chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(resolve => setTimeout(resolve, 300));
                
                // Focus the input
                chatInput.focus();
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Clear any existing value
                chatInput.value = '';
                
                // Set the value character by character (some inputs require this)
                for (let i = 0; i < userMessage.length; i++) {
                    chatInput.value += userMessage[i];
                    chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
                
                // Also set value directly
                chatInput.value = userMessage;
                
                // Trigger multiple events to ensure it's recognized
                chatInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                chatInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                chatInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // Try to find and click send button
                const sendSelectors = [
                    'button[aria-label*="Send" i]',
                    '.cuf-send-button',
                    'button[title*="Send" i]',
                    'button.cuf-send-button',
                    'button[type="submit"]',
                    '.embeddedServiceSidebar button[type="submit"]'
                ];
                
                let sendButton = null;
                for (const selector of sendSelectors) {
                    const sidebar = document.querySelector('.embeddedServiceSidebar');
                    if (sidebar) {
                        sendButton = sidebar.querySelector(selector);
                    }
                    if (!sendButton) {
                        sendButton = document.querySelector(selector);
                    }
                    if (sendButton && !sendButton.disabled && sendButton.offsetParent !== null) {
                        break;
                    }
                }
                
                if (sendButton && !sendButton.disabled) {
                    console.log('Found send button, clicking');
                    sendButton.click();
                } else {
                    // Fallback: simulate Enter key press
                    console.log('Send button not found, simulating Enter key');
                    const enterEvent = new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true
                    });
                    chatInput.dispatchEvent(enterEvent);
                    
                    // Also try keypress and keyup
                    chatInput.dispatchEvent(new KeyboardEvent('keypress', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true
                    }));
                    chatInput.dispatchEvent(new KeyboardEvent('keyup', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true
                    }));
                }
                
                // Set timeout for response
                setTimeout(() => {
                    if (this.isProcessing) {
                        this.statusText = 'Waiting for agent response...';
                    }
                }, 3000);
                
            } else {
                throw new Error('Chat input not found. Please ensure the agent chat is open on the page. Try clicking the chat button first.');
            }
            
        } catch (error) {
            console.error('Error sending message:', error);
            this.statusText = 'Error: ' + error.message;
            this.showToast('Error', error.message, 'error');
            this.isProcessing = false;
            this.updateUI('idle');
        }
    }
    
    speak(text) {
        if (!this.synthesis) {
            this.isProcessing = false;
            this.updateUI('idle');
            this.statusText = 'Click to speak again';
            return;
        }
        
        this.isSpeaking = true;
        this.updateUI('speaking');
        this.statusText = 'Speaking...';
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        utterance.onend = () => {
            this.isSpeaking = false;
            this.isProcessing = false;
            this.updateUI('idle');
            this.statusText = 'Click to speak again';
        };
        
        utterance.onerror = () => {
            this.isSpeaking = false;
            this.isProcessing = false;
            this.updateUI('idle');
            this.statusText = 'Error speaking';
        };
        
        this.synthesis.speak(utterance);
    }
    
    addMessage(role, text) {
        const messageId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        this.conversationHistory = [...this.conversationHistory, { id: messageId, role, text }];
    }
    
    updateUI(state) {
        const button = this.template.querySelector('.voice-button');
        const indicator = this.template.querySelector('.status-indicator');
        
        if (button) {
            button.className = 'voice-button';
            if (state === 'listening') {
                button.classList.add('listening');
            } else if (state === 'speaking') {
                button.classList.add('speaking');
            } else if (state === 'processing') {
                button.classList.add('processing');
            }
        }
        
        if (indicator) {
            if (state === 'listening') {
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }
        }
    }
    
    showToast(title, message, variant) {
        const evt = new ShowToastEvent({
            title: title,
            message: message,
            variant: variant
        });
        this.dispatchEvent(evt);
    }
}

