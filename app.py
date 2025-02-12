# app.py
# This is the main Flask application file.
# It handles routes for uploading files, processing text/voice messages,
# interfacing with external APIs (Metis, LlamaParse, Speechmatics) and session management.

from flask import Flask, render_template, request, jsonify, session
import os
import uuid
import requests
from dotenv import load_dotenv
from llama_parse import LlamaParse
import logging

# Import libraries for Speechmatics transcription
from speechmatics.models import BatchTranscriptionConfig
from speechmatics.batch_client import BatchClient
from httpx import HTTPStatusError

# Load environment variables from a .env file
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
# Set upload folder path for file uploads
app.config['UPLOAD_FOLDER'] = 'static/uploads'
# Set maximum allowed file size (5 MB)
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024
# Set the secret key for session management
app.secret_key = os.environ.get("FLASK_SECRET_KEY", 'default-secret-key')

# Configure logging settings
logging.basicConfig(level=logging.ERROR, format='%(asctime)s - %(levelname)s - %(message)s')

# Load API keys and configuration values from environment variables
METIS_API_KEY = os.environ["METIS_API_KEY"]
METIS_API_URL = "https://api.metisai.ir/api/v1"
LLAMA_PARSE_API_KEY = os.environ["LLAMAPARSE_API_KEY"]
BOT_ID = os.environ["BOT_ID_HERE"]
# Speechmatics API key (you can define this value in your .env file)
SPEECHMATICS_API_KEY = os.environ.get("SPEECHMATICS_API_KEY")

def allowed_file(filename):
    """
    Check if the uploaded file has an allowed extension.
    Allowed extensions: png, jpg, jpeg, pdf, wav
    """
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in {'png', 'jpg', 'jpeg', 'pdf', 'wav'}

@app.route('/')
def index():
    """
    Render the main page of the application.
    """
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    """
    Handle file upload via POST request.
    Validate the file and save it to the upload folder with a unique filename.
    Return a JSON response with the file name and URL.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'هیچ فایلی انتخاب نشده'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'فایل نامعتبر'}), 400
    if file and allowed_file(file.filename):
        # Generate a unique filename using uuid and preserve original extension
        filename = str(uuid.uuid4()) + os.path.splitext(file.filename)[1]
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        # Ensure the upload folder exists
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        file.save(filepath)
        return jsonify({
            'filename': filename,
            'url': f'/static/uploads/{filename}'
        }), 200
    return jsonify({'error': 'نوع فایل مجاز نیست'}), 400

@app.route('/process', methods=['POST'])
def process_message():
    """
    Process the incoming text and/or files.
    For each uploaded file, attempt to parse the image using LlamaParse.
    Combine the parsed text with any provided text input and send the combined query
    to the Metis API for processing. Store the conversation in session.
    """
    text = request.form.get('text', '')
    files = request.files.getlist('files')
    parsed_texts = []
    # Loop through each file and process if allowed
    for file in files:
        if file and allowed_file(file.filename):
            parsed_text = parse_image_with_llama(file)
            if parsed_text:
                parsed_texts.append(parsed_text)
    # Combine the user input text with any parsed text from images
    if text:
        final_query = text + "\n" + "\n".join(parsed_texts)
    else:
        final_query = "\n".join(parsed_texts)
    final_query = final_query.strip()

    # If no text is available, and files were provided, set a default query text
    if not final_query:
        if files:
            final_query = "تصویر بارگذاری شده"
        else:
            return jsonify({'response': 'لطفا یک سوال وارد کنید'}), 400

    # Process the final query using the Metis RAG API
    response = process_with_metis_rag(final_query)
    # Initialize chat session if not already present
    session.setdefault('current_chat', [])
    # Append user message to the chat history in session
    session['current_chat'].append({
        'role': 'user',
        'content': final_query
    })
    # Append assistant's response to the chat history in session
    session['current_chat'].append({
        'role': 'assistant',
        'content': response
    })
    session.modified = True
    return jsonify({'response': response})

def parse_image_with_llama(file):
    """
    Use the LlamaParse API to extract text from an image file.
    Save the file temporarily, call the API with a detailed instruction,
    then delete the file and return the parsed text.
    """
    try:
        # Ensure the upload folder exists
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        # Generate a unique filename for the image
        filename = str(uuid.uuid4()) + os.path.splitext(file.filename)[1]
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        # Detailed instruction for parsing the image content in JSON format
        instruction = """
        لطفاً محتوای داخل عکس را با فرمت JSON طبق دستورالعمل زیر استخراج کنید:
        ۱. ساختار کلی JSON باید شامل یک کلید باشد بنام: سوال: شامل متن اصلی سوال به همراه چهار گزینه تستی.
        ۲. بخش question متن سوال را در ابتدا بنویسید. پس از سوال، گزینه‌های تستی را با شماره‌گذاری در خطوط جداگانه وارد کنید. از جداکنندهٔ خطی \n و اسپیس برای تفکیک بخش‌های مختلف استفاده کنید. مثال قالب‌بندی:
        سوال: [متن اصلی سوال]
        گزینه‌ها:
        1) [گزینه اول]
        2) [گزینه دوم]
        3) [گزینه سوم]
        4) [گزینه چهارم]
        ۳. تمامی فرمول‌های ریاضی را با استفاده از نمادهای LaTeX ($...$ یا $$...$$) بنویسید. از جداکنندهٔ خطی \n برای تفکیک بخش‌های مختلف توضیح استفاده کنید.
        ۴. فرمت‌بندی LaTeX تمامی فرمول‌های ریاضی باید مطابق با قوانین LaTeX نوشته شوند تا به درستی رندر و پردازش شوند.
        ۵. توجه به یکدستی در کلیدها و ساختار اطمینان حاصل کنید که همه رکوردها دارای کلیدهای question و answer به صورت یکسان هستند. فرمت‌بندی یکدست کمک می‌کند تا مدل بتواند الگوهای مشخصی را شناسایی و یاد بگیرد.
        ۶. بدون اینکه ساختار یا شکل فرمول‌ها رو تغییر بدی یا اینکه فرمول‌ها رو ساده‌سازی کنی دقیقاً همان فرمول موجود در عکس و تمامی علائم و حروف یونانی را دقیقاً به صورت LaTeX بنویس و اعداد رو انگلیسی بنویس اما فقط می‌خوام متن داخل عکس رو استخراج کنی.
        ۷. تمامی فرمولهای ریاضی رو از چپ به راست بخوان و بنویس.
        ۸. فرمولهای ریاضی با اعداد فارسی نوشته شدن؛ لطفاً با دقت زیاد اعداد فارسی رو شناسایی کن و بنویس.
        ۹. نیازی به استخراج متادیتا یا توضیحات در مورد عکس نیست فقط متن داخل عکس رو استخراج کن همین
        """
        # Initialize the LlamaParse parser with the API key and settings
        parser = LlamaParse(
            api_key=LLAMA_PARSE_API_KEY,
            result_type="markdown",
            gpt4o_mode=True,
            parsing_instruction=instruction,
        )
        # Call the parser to load and process the image file
        parsed_result = parser.load_data(file_path)
        # Delete the temporary file after processing
        os.unlink(file_path)
        # Save the parsed result to an output text file (for debugging/testing)
        output_path = os.path.join(app.config['UPLOAD_FOLDER'], 'llama_parse_output.txt')
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(parsed_result[0].text if parsed_result else '')
        # Return the parsed text if available
        return parsed_result[0].text if parsed_result else None
    except Exception as e:
        # Log any errors encountered during parsing
        logging.error(f"LlamaParse Error: {str(e)}")
        return None

def process_with_metis_rag(query):
    """
    Process the given query using the Metis Retrieval Augmented Generation (RAG) API.
    If a session does not exist, create a new session.
    Append the new message and get the response from the API.
    """
    try:
        # Check if a Metis session already exists in the user session
        if 'metis_session_id' not in session:
            session_id = create_metis_session()
            if not session_id:
                return "خطا در ایجاد نشست چت"
            session['metis_session_id'] = session_id
        else:
            session_id = session['metis_session_id']
        # Define the API endpoint for sending a message
        url = f"{METIS_API_URL}/chat/session/{session_id}/message"
        headers = {
            'Authorization': f'Bearer {METIS_API_KEY}',
            'Content-Type': 'application/json'
        }
        data = {
            "message": {
                "content": query,
                "type": "USER"
            }
        }
        # Send the POST request to the Metis API with a timeout of 30 seconds
        response = requests.post(url, json=data, headers=headers, timeout=30)
        response.raise_for_status()
        # Retrieve the content from the API response
        result = response.json().get('content', 'پاسخی دریافت نشد')
        return result
    except Exception as e:
        # Log any errors encountered while processing with Metis API
        logging.error(f"Metis API Error: {str(e)}")
        return "خطا در پردازش درخواست"

def create_metis_session():
    """
    Create a new chat session with the Metis API.
    Returns the session ID if successful, otherwise None.
    """
    try:
        url = f"{METIS_API_URL}/chat/session"
        headers = {
            'Authorization': f'Bearer {METIS_API_KEY}',
            'Content-Type': 'application/json'
        }
        data = {"botId": BOT_ID}
        response = requests.post(url, json=data, headers=headers)
        response.raise_for_status()
        session_id = response.json().get('id')
        return session_id
    except Exception as e:
        # Log any errors encountered during session creation
        logging.error(f"Session Creation Error: {str(e)}")
        return None

def convert_voice_to_text(audio_filepath):
    """
    Convert the given audio file to text using the Speechmatics service.
    Configure the transcription job with settings such as language, speaker diarization,
    and additional vocabulary.
    Returns the transcript text or an error message.
    """
    job_config = BatchTranscriptionConfig(
        language="fa",
        enable_entities=True,
        enable_transcript_speaker_diarization=True,
        operating_point="enhanced",  # Use enhanced mode for higher accuracy
        audio_filtering_config={"volume_threshold": 3.4},  # Filter out background noise
        additional_vocab=[
            {"content": "تابع، معادله، رادیکال، فرجه، کسر، تقسیم، حاصل، عبارت، فرمول، سینوس، کوسینوس، انتگرال، مشتق، ترکیبیات، احتمال، مجموعه، متغیر، معادله، معکوس، متناهی، نامتناهی، مثلث، متوازی‌الاضلاع، متوازی‌الضلع، متقارن، متعامد، متمم"},
            {"content": "ََB", "sounds_like": ["بی"]},
            {"content": "ََA", "sounds_like": ["آ، ای"]},
            {"content": "ََC", "sounds_like": ["سی"]}
        ]
    )
    transcript = ""
    # Initialize the Speechmatics batch client and submit the job
    with BatchClient(SPEECHMATICS_API_KEY) as client:
        try:
            job_id = client.submit_job(audio_filepath, job_config)
            # Wait for the transcription job to complete and retrieve the result in text format
            transcript = client.wait_for_completion(job_id, transcription_format="txt")
        except HTTPStatusError as e:
            transcript = f"خطا در تبدیل صدا به متن: {e}"
    return transcript

@app.route('/voice', methods=['POST'])
def process_voice():
    """
    Process the incoming voice data.
    Save the received audio file temporarily, convert it to text using Speechmatics,
    save the transcript, and then process the text with the Metis API.
    Update the chat session with both the voice transcript and the assistant response.
    """
    if 'audio_data' not in request.files:
        return jsonify({'error': 'فایل صوتی ارسال نشده است'}), 400
    audio_file = request.files['audio_data']
    if audio_file.filename == '':
        return jsonify({'error': 'فایل نامعتبر'}), 400

    # Save the audio file temporarily in the uploads folder
    filename = str(uuid.uuid4()) + ".wav"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    audio_file.save(filepath)

    # Convert the audio file to text using Speechmatics
    transcript = convert_voice_to_text(filepath)

    # Save the transcript result to a file (for testing/debugging)
    result_filename = "result_" + filename.split('.')[0] + ".txt"
    result_filepath = os.path.join(app.config['UPLOAD_FOLDER'], result_filename)
    with open(result_filepath, "w", encoding="utf-8") as f:
        f.write(transcript)

    # (Optional) Delete the audio file after processing if not needed further
    # os.remove(filepath)

    final_query = transcript.strip()
    if not final_query:
        return jsonify({'response': 'متن استخراج نشد'}), 400

    response_text = process_with_metis_rag(final_query)
    # Update the session chat history with user voice input and assistant's response
    session.setdefault('current_chat', [])
    session['current_chat'].append({
        'role': 'user',
        'content': final_query
    })
    session['current_chat'].append({
        'role': 'assistant',
        'content': response_text
    })
    session.modified = True
    return jsonify({'transcript': transcript, 'response': response_text})

@app.route('/new-chat', methods=['POST'])
def new_chat():
    """
    Clear the current chat session to start a new conversation.
    """
    session.clear()
    return jsonify({'success': True})

if __name__ == '__main__':
    # Ensure the upload folder exists when the application starts
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    # Run the Flask app on host 0.0.0.0 and port 8080 in debug mode
    app.run(host='0.0.0.0', port=8080, debug=False)
