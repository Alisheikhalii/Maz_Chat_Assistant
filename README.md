A smart chatbot designed to answer math and science questions, supporting text, voice, and image inputs. The Smart Assistant Project is an interactive AI chatbot designed to assist students in solving problems and understanding mathematical concepts and more. This system is specifically built to answer subject-specific mathematics questions and supports three different input methods:

![cc](https://github.com/user-attachments/assets/6c256020-1f50-40d9-92fc-4c6f0f9a2c8e)


├── static/ │ ├── uploads/ # Stores uploaded files (images, audio) │ ├── style.css # Styles for the UI │ ├── script.js # Handles user interactions │ └── logo.png # Project logo ├── templates/ │ └── index.html # Main web application page └── app.py # Main application file (Flask Backend) ├── README.md └── LICENSE

Math-Chat-Assistant 🤖📚
✨ Key Features
Supports multiple input methods:
📝 Text (via the built-in math formula editor)
🎤 Voice (speech-to-text conversion)
📷 Image (extracts text from uploaded math questions)
Intelligent Responses: Utilizes Metis RAG for precise and context-aware answers.
Formula Processing: Professional LaTeX rendering with MathJax.
Modern UI: Responsive design with full Persian language support.
🛠 Technologies Used
Backend: Flask (Python)
AI Services: Metis RAG, LlamaParse, Speechmatics
Frontend: HTML5, CSS3, MathLive, MathJax
Database: Session-based (temporary)
🚀 Getting Started
1. Clone the repository:
git clone https://github.com/Alisheikhalii/Math-Chat-Assistant.git
2. Install dependencies:
```pip install -r requirements.txt```

3. Set up the .env file with API keys

4. Run the application:
```python app.py```
