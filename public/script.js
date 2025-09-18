let allData = [];

fetch('/api/questions')
  .then(res => res.json())
  .then(data => {
    allData = data;
  });

document.getElementById('search').addEventListener('input', function () {
  const query = this.value.toLowerCase();
  const results = document.getElementById('results');
  results.innerHTML = '';

  if (query.length < 2) return;

  const filtered = allData.filter(item =>
    item.question.toLowerCase().includes(query) ||
    item.feedback.toLowerCase().includes(query)
  );

  filtered.slice(0, 50).forEach(item => {
    const el = document.createElement('div');
    el.className = 'result';
    el.innerHTML = `<strong>Q:</strong> ${item.question}<br>
                    <strong>A:</strong> ${item.feedback}<br>
                    <div class="source">${item.source}</div>`;
    results.appendChild(el);
  });
});
