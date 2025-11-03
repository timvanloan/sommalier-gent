# Sommelier Voice - Voice-Enabled Wine Agent

This is the voice-enabled version of the Sommalier Gent wine agent, powered by OpenAI's ChatGPT API.

## Features

- **Voice Interaction**: Speak to the agent and receive spoken responses
- **Speech Recognition**: Uses browser Web Speech API for listening
- **Text-to-Speech**: Uses browser Web Speech API for speaking
- **OpenAI Integration**: Uses ChatGPT API for intelligent wine recommendations
- **Conversation History**: Maintains context across interactions
- **Same Styling**: Matches the visual design of the text-based agent

## Routes

- `/` - Text-based agent (original)
- `/voice` - Voice-enabled agent (new)

## Setup

The voice agent uses the `CHATGPT_API_KEY` environment variable stored in Heroku.

## Usage

1. Navigate to `/voice` on the deployed site
2. Click the microphone button to start listening
3. Speak your question or request
4. The agent will respond with spoken audio
5. Continue the conversation naturally

