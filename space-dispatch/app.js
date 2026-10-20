async function loadSpaceData() {
    try {
        // Fetch the locally stored data.json file that GitHub Actions updates
        const response = await fetch('data.json');
        const data = await response.json();

        document.getElementById('title').textContent = data.title;
        document.getElementById('date').textContent = `Date: ${data.date}`;
        document.getElementById('space-image').src = data.url;
        document.getElementById('space-image').alt = data.title;
        document.getElementById('explanation').textContent = data.explanation;
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('title').textContent = 'Failed to load latest dispatch.';
    }
}

loadSpaceData();