const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_DIR = path.join(__dirname, 'data');
const PORT = 3000;

app.use(express.static('public'));

app.get('/api/questions', (req, res) => {
    let allQuestions = [];

    fs.readdirSync(DATA_DIR).forEach(file => {
        if (file.endsWith('.json')) {
            const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
            try {
                const questions = JSON.parse(content);
                questions.forEach(q => {
                    allQuestions.push({
                        ...q,
                        source: file
                    });
                });
            } catch (e) {
                console.error(`Error parsing ${file}: ${e}`);
            }
        }
    });

    res.json(allQuestions);
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
