import sqlite3
import json
import os

# Folder containing JSON files
json_folder = "data"
db_file = "navigation_questions.db"

def create_database():
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    # Enable FTS5 for better full-text search
    cursor.execute('''
        CREATE VIRTUAL TABLE IF NOT EXISTS questions USING fts5(
            filename, question, feedback
        );
    ''')
    conn.commit()
    conn.close()

def load_json_files():
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()

    for file in os.listdir(json_folder):
        if file.endswith(".json"):
            filepath = os.path.join(json_folder, file)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for item in data:
                        question = item.get("question", "").strip()
                        feedback = item.get("feedback", "").strip()
                        if question:
                            cursor.execute('''
                                INSERT INTO questions (filename, question, feedback)
                                VALUES (?, ?, ?)
                            ''', (file, question, feedback))
            except Exception as e:
                print(f"Failed to load {file}: {e}")

    conn.commit()
    conn.close()

def search_questions(query):
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT filename, question, feedback
        FROM questions
        WHERE questions MATCH ?
    ''', (query,))
    results = cursor.fetchall()
    conn.close()
    return results

if __name__ == "__main__":
    # Step 1: Create DB & Table
    create_database()

    # Step 2: Load JSON files from folder
    load_json_files()

    # Step 3: Search loop
    while True:
        keyword = input("\n🔍 Enter search term (or 'exit' to quit): ").strip()
        if keyword.lower() == "exit":
            break
        results = search_questions(keyword)
        if results:
            for i, (filename, question, feedback) in enumerate(results, 1):
                print(f"\nResult {i} (from {filename}):\nQ: {question}\nA: {feedback}")
        else:
            print("No matches found.")
