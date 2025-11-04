import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class SommalierVoiceAgent extends LightningElement {
    @track conversationHistory = [];
    @track isListening = false;
    @track isProcessing = false;
    @track isSpeaking = false;
    @track statusText = 'Click to start speaking';
    @track transcriptPreview = '';
    @track conversationId = null;
    
    recognition = null;
    synthesis = null;
    
    connectedCallback() {
        this.initializeSpeechRecognition();
        this.initializeSpeechSynthesis();
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
            const response = await fetch('/services/apexrest/sommalier-voice-chat/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: userMessage,
                    conversationId: this.conversationId
                })
            });
            
            const data = await response.json();
            
            if (data.success && data.response) {
                if (data.conversationId) {
                    this.conversationId = data.conversationId;
                }
                
                this.addMessage('assistant', data.response);
                this.speak(data.response);
            } else {
                throw new Error(data.error || 'No response from agent');
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
        this.conversationHistory = [...this.conversationHistory, { role, text }];
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

