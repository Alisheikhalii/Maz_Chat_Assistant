// script.js
// This file contains the JavaScript code to handle chat interactions,
// file uploads, voice recording, math formula insertion, and UI animations.

document.addEventListener('DOMContentLoaded', () => {
  // Get references to DOM elements
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const chatContainer = document.getElementById('chat-container');
  const fileInput = document.getElementById('file-input');
  const filePreview = document.getElementById('file-preview');
  const popupMenuToggle = document.getElementById('popup-menu-toggle');
  const popupMenu = document.getElementById('popup-menu');
  const mathEditorContainer = document.getElementById('math-editor-container');
  const mathEditor = document.getElementById('math-editor');
  const insertMathFormulaBtn = document.getElementById('insert-math-formula');
  const closeMathEditorBtn = document.getElementById('close-math-editor');
  let attachedFiles = [];
  // Check if running inside Telegram WebApp
  const isTelegramWebApp = window.Telegram && window.Telegram.WebApp;
  let originalViewportHeight = window.innerHeight;
  let isKeyboardOpen = false;
  
  let mediaRecorder;
  let audioChunks = [];
  let listeningTimer;  

  /**
   * Starts a simple animation in the input field to indicate that voice is being recorded.
   */
  function startListeningAnimation() {
    let dotCount = 0;
    messageInput.value = "listening";
    listeningTimer = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      let dots = ".".repeat(dotCount);
      messageInput.value = "listening" + dots;
    }, 500);
  }

  /**
   * Stops the listening animation and resets the input field.
   */
  function stopListeningAnimation() {
    clearInterval(listeningTimer);
    listeningTimer = null;
    messageInput.value = "";  
  }

  /**
   * Check if the current device supports touch.
   */
  function isTouchDevice() {
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  }

  /**
   * Scroll the input container into view (used especially when keyboard opens).
   */
  function scrollInputIntoView() {
    const inputContainer = document.querySelector('.input-container');
    if (inputContainer) {
      inputContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /**
   * Handles viewport changes (e.g., when the virtual keyboard is displayed).
   */
  function handleViewportChanges() {
    const currentViewportHeight = window.innerHeight;
    const keyboardHeight = originalViewportHeight - currentViewportHeight;
    if (keyboardHeight > 100) {
      isKeyboardOpen = true;
      const inputRect = messageInput.getBoundingClientRect();
      const scrollAmount = inputRect.top - (window.innerHeight - 250);
      window.scrollTo({
        top: window.scrollY + scrollAmount,
        behavior: 'smooth'
      });
    } else {
      isKeyboardOpen = false;
    }
  }
  window.addEventListener('resize', handleViewportChanges);

  // Focus event for the message input
  messageInput.addEventListener('focus', () => {
    setTimeout(() => {
      if (isTelegramWebApp) {
        // Adjust scrolling if running in Telegram WebApp
        const inputRect = messageInput.getBoundingClientRect();
        const offset = inputRect.top - window.innerHeight + inputRect.height + 100;
        window.scrollTo({ top: offset, behavior: 'smooth' });
      } else {
        // Scroll chat container to bottom
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
      }
    }, 300);
  });

  // Dismiss input focus when touching outside of the input field
  document.addEventListener('touchstart', (e) => {
    if (e.target !== messageInput) {
      messageInput.blur();
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    }
  });

  /**
   * Sends the message and any attached files to the server for processing.
   */
  async function sendMessage() {
    // If voice recording is active, stop recording before sending
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      return;
    }

    const text = messageInput.value.trim();
    // Do nothing if there is no text and no files attached
    if (!text && attachedFiles.length === 0) return;

    // Add user message to the chat UI (also formatting numbers)
    addMessage('user', text.replace(/(\d+)/g, match => parseInt(match).toLocaleString('en-US')), attachedFiles);

    try {
      // Display a processing message while waiting for the server response
      addProcessingMessage();

      const formData = new FormData();
      // Append each attached file to the form data
      attachedFiles.forEach(file => formData.append('files', file));
      if (text) {
        formData.append('text', text);
      }

      // Send POST request to /process endpoint with form data
      const response = await fetch('/process', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      removeProcessingMessage();
      // Add assistant's response message to the chat UI
      addMessage('assistant', data.response.replace(/(\d+)/g, match => parseInt(match).toLocaleString('en-US')));
    } catch (error) {
      console.error('Error:', error);
      addMessage('assistant', 'خطا در ارتباط با سرور');
    }

    // Reset the input field and file attachments
    messageInput.value = '';
    fileInput.value = '';
    attachedFiles = [];
    updateFilePreview();
  }

  /**
   * Handle key press event; send message on Enter (without Shift).
   */
  function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  /**
   * Handle file uploads and update the list of attached files.
   */
  function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    attachedFiles = [...attachedFiles, ...files];
    updateFilePreview();
  }

  /**
   * Add a new message element to the chat container.
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content - Message content (HTML allowed)
   * @param {Array} files - Optional attached files to show
   */
  function addMessage(role, content, files = []) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    // If there are attached files, create a file list HTML snippet
    if (files.length > 0) {
      const fileList = files.map(file => 
        `<div class="file-preview-item">
          <span class="file-name">${file.name}</span>
        </div>`
      ).join('');
      content += `<div class="file-list">${fileList}</div>`;
    }
    messageDiv.innerHTML = content;
    chatContainer.appendChild(messageDiv);
    // Typeset MathJax formulas in the new message
    MathJax.typesetPromise([messageDiv]).catch(err => console.log('MathJax typeset error:', err));
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
  }

  /**
   * Add a processing (typing) indicator message from the assistant.
   */
  function addProcessingMessage() {
    const processingDiv = document.createElement('div');
    processingDiv.className = 'message assistant processing';
    processingDiv.innerHTML = 
      `<div class="typing-indicator">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>`;
    chatContainer.appendChild(processingDiv);
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
  }

  /**
   * Remove the processing (typing) indicator from the chat UI.
   */
  function removeProcessingMessage() {
    document.querySelectorAll('.processing').forEach(msg => msg.remove());
  }

  /**
   * Update the file preview area to display currently attached files.
   */
  function updateFilePreview() {
    filePreview.innerHTML = '';
    attachedFiles.forEach((file, index) => {
      const previewItem = document.createElement('div');
      previewItem.className = 'file-preview-item';
      previewItem.innerHTML = 
        `<span class="remove-btn" onclick="removeFile(${index})">×</span>
         <span class="file-name">${file.name}</span>`;
      filePreview.appendChild(previewItem);
    });
  }

  // Expose removeFile function to the global scope for inline onclick events
  window.removeFile = index => {
    attachedFiles.splice(index, 1);
    updateFilePreview();
  };

  // Adjust the height of the message input based on its content
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = `${messageInput.scrollHeight}px`;
  });

  // Event listeners for sending messages and handling file uploads
  sendButton.addEventListener('click', sendMessage);
  fileInput.addEventListener('change', handleFileUpload);
  messageInput.addEventListener('keypress', handleKeyPress);

  // Event listener for inserting a math formula into the message input
  insertMathFormulaBtn.addEventListener('click', () => {
    const latexFormula = mathEditor.value;
    if (latexFormula.trim() !== '') {
      messageInput.value += ' ' + latexFormula + ' ';
      messageInput.focus();
    }
    mathEditorContainer.style.display = 'none';
    setTimeout(scrollInputIntoView, 300);
  });

  // Close the math editor when the close button is clicked
  closeMathEditorBtn.addEventListener('click', () => {
    mathEditorContainer.style.display = 'none';
    setTimeout(scrollInputIntoView, 300);
  });

  // Toggle the popup menu when the toggle button is clicked
  popupMenuToggle.addEventListener('click', () => {
    if (popupMenu.style.display === 'none' || popupMenu.style.display === '') {
      popupMenu.style.display = 'flex';
      popupMenu.style.flexDirection = 'column';
    } else {
      popupMenu.style.display = 'none';
    }
  });

  // Popup menu option for file upload
  document.getElementById('popup-file').addEventListener('click', () => {
    popupMenu.style.display = 'none';
    fileInput.click();
  });

  // Popup menu option for math editor
  document.getElementById('popup-math').addEventListener('click', () => {
    popupMenu.style.display = 'none';
    mathEditorContainer.style.display = 'block';
    mathEditor.focus();
    setTimeout(scrollInputIntoView, 300);
  });

  // Popup menu option for voice recording
  document.getElementById('popup-voice').addEventListener('click', () => {
    popupMenu.style.display = 'none';
    toggleVoiceRecording();
  });

  /**
   * Toggle voice recording on/off.
   * If already recording, stop the recording; otherwise, start recording.
   */
  async function toggleVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    } else {
      try {
        // Request microphone access and start recording
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        startListeningAnimation();
        // Collect audio chunks as they become available
        mediaRecorder.addEventListener('dataavailable', event => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        });
        // When recording stops, process the audio blob
        mediaRecorder.addEventListener('stop', () => {
          stopListeningAnimation();
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          sendVoiceToServer(audioBlob);
        });
        mediaRecorder.start();
      } catch (err) {
        console.error("خطا در دسترسی به میکروفون:", err);
        alert("دسترسی به میکروفون امکان‌پذیر نیست.");
      }
    }
  }

  /**
   * Convert a Blob object to a WAV format Blob.
   * @param {Blob} blob - The original audio blob.
   * @returns {Blob} - The converted WAV audio blob.
   */
  async function convertBlobToWav(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const wavBuffer = encodeWAV(audioBuffer.getChannelData(0), audioBuffer.sampleRate);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  /**
   * Helper function to write a string into a DataView at the specified offset.
   */
  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * Convert a Float32Array of audio samples to 16-bit PCM.
   */
  function floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, input[i]));
      s = s < 0 ? s * 0x8000 : s * 0x7FFF;
      output.setInt16(offset, s, true);
    }
  }

  /**
   * Encode audio samples into a WAV file format.
   */
  function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); // Mono audio
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);
    floatTo16BitPCM(view, 44, samples);
    return buffer;
  }

  /**
   * Send the recorded voice (converted to WAV) to the server.
   */
  async function sendVoiceToServer(audioBlob) {
    try {
      // Convert the recorded audio blob to WAV format
      const wavBlob = await convertBlobToWav(audioBlob);
      
      // Create a temporary processing message in the chat UI
      const voiceProcessingDiv = document.createElement('div');
      voiceProcessingDiv.className = 'message assistant processing voice-processing';
      voiceProcessingDiv.innerHTML = `<span>در حال پردازش ویس</span><div class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
      chatContainer.appendChild(voiceProcessingDiv);
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
      
      // Prepare form data with the WAV blob for the /voice endpoint
      const formData = new FormData();
      formData.append("audio_data", wavBlob, "recorded_temp.wav");
      const response = await fetch("/voice", {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      
      // Remove the processing indicator after receiving the response
      voiceProcessingDiv.remove();
      
      if (data.error) {
        alert(data.error);
      } else {
        // Add user transcript and assistant response to the chat UI
        addMessage('user', data.transcript);
        addMessage('assistant', data.response);
      }
    } catch (err) {
      console.error("خطا در ارسال فایل صوتی:", err);
      alert("خطا در ارسال فایل صوتی.");
    }
  }
});
