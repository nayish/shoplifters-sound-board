// Sound board functionality
let soundsData = {};
let audioContext = null;
let bufferCache = {}; // Cache AudioBuffers by filename
let currentSource = null; // Current AudioBufferSourceNode
let playRequestId = 0; // Track latest play request to ignore stale async operations
let selectedSong = 'all'; // Currently selected song filter
let isRandomPlaying = false; // Track if random continuous playback is active
let randomPlaybackStop = false; // Flag to stop random playback

// Initialize AudioContext (must be done on user interaction)
function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

// Load sounds configuration
async function loadSoundsConfig() {
    try {
        const response = await fetch('sounds.json');
        soundsData = await response.json();
    } catch (error) {
        console.error('Error loading sounds.json:', error);
    }
}

// Load audio file as AudioBuffer
async function loadAudioBuffer(filename) {
    if (bufferCache[filename]) {
        return bufferCache[filename];
    }
    
    // Ensure audio context is initialized
    const context = initAudioContext();
    if (!context) {
        console.error('AudioContext not available');
        return null;
    }
    
    try {
        const response = await fetch(filename);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await context.decodeAudioData(arrayBuffer);
        bufferCache[filename] = audioBuffer;
        console.log('Loaded audio buffer:', filename);
        return audioBuffer;
    } catch (error) {
        console.error('Error loading audio buffer:', filename, error);
        return null;
    }
}

// Preload all audio files
async function preloadAudio() {
    const files = new Set();
    
    Object.values(soundsData.sounds || {}).forEach(segments => {
        segments.forEach(segment => {
            files.add(segment.file);
        });
    });
    
    // Load all files as AudioBuffers
    for (const filename of files) {
        await loadAudioBuffer(filename);
    }
    
    console.log('All audio files preloaded');
}

// Stop current playback
function stopCurrentPlayback() {
    if (currentSource) {
        try {
            currentSource.stop();
        } catch (e) {
            // Source might already be stopped, ignore error
        }
        try {
            currentSource.disconnect();
        } catch (e) {
            // Source might already be disconnected, ignore error
        }
        currentSource = null;
    }
}

// Play a random segment for a person
async function playSoundSegment(name) {
    // Stop random playback if a button is clicked
    if (isRandomPlaying) {
        stopRandomSequence();
    }
    
    // Stop current playback immediately (synchronously, before any async work)
    stopCurrentPlayback();
    
    // Increment request ID to mark this as the latest request
    playRequestId++;
    const thisRequestId = playRequestId;
    
    const segments = soundsData.sounds?.[name];
    if (!segments || segments.length === 0) return;
    
    // Filter segments by selected song if not "all"
    let availableSegments = segments;
    if (selectedSong !== 'all') {
        availableSegments = segments.filter(segment => segment.file === selectedSong);
        if (availableSegments.length === 0) return; // No segments for this song
    }
    
    // Pick a random segment from available segments
    const segment = availableSegments[Math.floor(Math.random() * availableSegments.length)];
    
    // Initialize AudioContext if needed
    const context = initAudioContext();
    
    // Resume context if suspended (required for some browsers)
    if (context.state === 'suspended') {
        await context.resume();
    }
    
    // Check if this is still the latest request (another click might have happened)
    if (thisRequestId !== playRequestId) {
        return; // Ignore this request, a newer one is in progress
    }
    
    // Get or load audio buffer
    const audioBuffer = await loadAudioBuffer(segment.file);
    if (!audioBuffer) return;
    
    // Check again if this is still the latest request
    if (thisRequestId !== playRequestId) {
        return; // Ignore this request, a newer one is in progress
    }
    
    // Stop again right before creating new source (in case another click happened during async)
    stopCurrentPlayback();
    
    // Final check before playing
    if (thisRequestId !== playRequestId) {
        return; // Ignore this request, a newer one is in progress
    }
    
    // Highlight the button for this name
    const button = document.querySelector(`.sound-button[data-name="${name}"]`);
    if (button) {
        button.classList.add('playing');
    }
    
    // Create new source node
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    
    currentSource = source;
    
    // Get duration from segment
    const duration = segment.duration;
    
    // Start playing from the offset time
    source.start(0, segment.start, duration);
    
    // Stop when finished (automatically stops at duration)
    source.onended = () => {
        if (currentSource === source) {
            currentSource = null;
        }
        // Remove highlight
        if (button) {
            button.classList.remove('playing');
        }
    };
}

// Play a segment for random sequence (sequential, with highlighting)
async function playSoundSegmentSequential(name) {
    const segments = soundsData.sounds?.[name];
    if (!segments || segments.length === 0) return Promise.resolve();
    
    // Filter segments by selected song if not "all"
    let availableSegments = segments;
    if (selectedSong !== 'all') {
        availableSegments = segments.filter(segment => segment.file === selectedSong);
        if (availableSegments.length === 0) return Promise.resolve();
    }
    
    // Pick a random segment from available segments
    const segment = availableSegments[Math.floor(Math.random() * availableSegments.length)];
    
    // Initialize AudioContext if needed
    const context = initAudioContext();
    
    // Resume context if suspended
    if (context.state === 'suspended') {
        await context.resume();
    }
    
    // Get or load audio buffer
    const audioBuffer = await loadAudioBuffer(segment.file);
    if (!audioBuffer) return Promise.resolve();
    
    // Stop current playback
    stopCurrentPlayback();
    
    // Highlight the button for this name
    const button = document.querySelector(`.sound-button[data-name="${name}"]`);
    if (button) {
        button.classList.add('playing');
    }
    
    // Create new source node
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    
    currentSource = source;
    
    // Get duration from segment
    const duration = segment.duration;
    
    // Start playing from the offset time
    source.start(0, segment.start, duration);
    
    // Return a promise that resolves when playback finishes
    return new Promise((resolve) => {
        source.onended = () => {
            if (currentSource === source) {
                currentSource = null;
            }
            // Remove highlight
            if (button) {
                button.classList.remove('playing');
            }
            resolve();
        };
    });
}

// Play random names continuously until stopped
async function playRandomSequence() {
    const availableNames = getAvailableNames();
    if (availableNames.length === 0) return;
    
    isRandomPlaying = true;
    randomPlaybackStop = false;
    
    // Play random names in a loop until stopped
    while (!randomPlaybackStop && isRandomPlaying) {
        // Pick a random name
        const randomName = availableNames[Math.floor(Math.random() * availableNames.length)];
        await playSoundSegmentSequential(randomName);
        
        // Small delay between sounds
        if (!randomPlaybackStop && isRandomPlaying) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    isRandomPlaying = false;
}

// Stop random playback
function stopRandomSequence() {
    randomPlaybackStop = true;
    isRandomPlaying = false;
    stopCurrentPlayback();
    
    // Remove all playing highlights
    document.querySelectorAll('.sound-button.playing').forEach(button => {
        button.classList.remove('playing');
    });
}

// Get all unique song files from sounds.json
function getAllSongs() {
    const files = new Set();
    Object.values(soundsData.sounds || {}).forEach(segments => {
        segments.forEach(segment => {
            files.add(segment.file);
        });
    });
    return Array.from(files).sort();
}

// Get all available names (filtered by selected song)
function getAvailableNames() {
    const names = Object.keys(soundsData.sounds || {});
    if (selectedSong === 'all') {
        return names;
    }
    // Filter names that have segments for the selected song
    return names.filter(name => {
        const segments = soundsData.sounds[name] || [];
        return segments.some(segment => segment.file === selectedSong);
    });
}

// Populate song picker dropdown
function populateSongPicker() {
    const songs = getAllSongs();
    const mainPicker = document.getElementById('song-picker');
    
    // Populate main picker
    songs.forEach(song => {
        const option = document.createElement('option');
        option.value = song;
        option.textContent = song.replace('.mp3', '');
        mainPicker.appendChild(option);
    });
}

// Get URL parameter value
function getURLParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// Set URL parameter without page reload
function setURLParam(name, value) {
    const url = new URL(window.location);
    if (value && value !== 'all') {
        url.searchParams.set(name, value);
    } else {
        url.searchParams.delete(name);
    }
    window.history.replaceState({}, '', url);
}

// Filter buttons and sections based on selected song
function filterButtonsBySong(song) {
    selectedSong = song;
    
    // Update URL parameter
    setURLParam('song', song);
    
    const sections = document.querySelectorAll('.team-section');
    
    sections.forEach(section => {
        const buttons = section.querySelectorAll('.sound-button');
        let hasVisibleButtons = false;
        
        buttons.forEach(button => {
            const name = button.getAttribute('data-name');
            const segments = soundsData.sounds?.[name] || [];
            
            if (song === 'all') {
                button.style.display = '';
                hasVisibleButtons = true;
            } else {
                const hasSong = segments.some(segment => segment.file === song);
                button.style.display = hasSong ? '' : 'none';
                if (hasSong) hasVisibleButtons = true;
            }
        });
        
        // Hide entire section if no visible buttons
        section.style.display = hasVisibleButtons ? '' : 'none';
    });
}

// Enable all interactive elements
function enableUI() {
    const buttons = document.querySelectorAll('.sound-button');
    const picker = document.getElementById('song-picker');
    const title = document.querySelector('header h1');
    
    buttons.forEach(button => {
        button.disabled = false;
    });
    picker.disabled = false;
    
    if (title) {
        title.classList.remove('blinking');
    }
}

// Disable all interactive elements
function disableUI() {
    const buttons = document.querySelectorAll('.sound-button');
    const picker = document.getElementById('song-picker');
    const title = document.querySelector('header h1');
    
    buttons.forEach(button => {
        button.disabled = true;
    });
    picker.disabled = true;
    
    if (title) {
        title.classList.add('blinking');
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
    // Disable everything initially
    disableUI();
    
    // Set a timeout to enable UI even if loading takes too long
    const loadingTimeout = setTimeout(() => {
        console.warn('Loading timeout - enabling UI anyway');
        enableUI();
    }, 10000); // 10 second timeout
    
    try {
    await loadSoundsConfig();
        
        // Populate song picker
        populateSongPicker();
        
        // Read song filter from URL parameter
        const urlSong = getURLParam('song');
        if (urlSong) {
            const mainPicker = document.getElementById('song-picker');
            // Check if the song exists in the picker options
            const songExists = Array.from(mainPicker.options).some(option => option.value === urlSong);
            if (songExists) {
                mainPicker.value = urlSong;
                selectedSong = urlSong;
                filterButtonsBySong(urlSong);
            }
        }
        
        // Initialize audio context (needed for preloading)
        const context = initAudioContext();
        
        // Try to preload all audio files
        // If it fails (e.g., context suspended), we'll enable UI anyway
        try {
            await preloadAudio();
            console.log('Preloading completed');
        } catch (preloadError) {
            console.warn('Preloading failed (may need user interaction):', preloadError);
        }
        
        // Clear timeout and enable everything once loaded
        clearTimeout(loadingTimeout);
        enableUI();
    } catch (error) {
        console.error('Error during initialization:', error);
        clearTimeout(loadingTimeout);
        // Enable UI even if there's an error so users can still try
        enableUI();
    }
    
    // Resume context on first user interaction if suspended
    const resumeContext = async () => {
        if (context && context.state === 'suspended') {
            await context.resume();
        }
        document.removeEventListener('click', resumeContext);
        document.removeEventListener('touchstart', resumeContext);
    };
    document.addEventListener('click', resumeContext);
    document.addEventListener('touchstart', resumeContext);
    
    // Handle main song picker change
    const mainPicker = document.getElementById('song-picker');
    mainPicker.addEventListener('change', function() {
        filterButtonsBySong(this.value);
    });
    
    const buttons = document.querySelectorAll('.sound-button');
    
    buttons.forEach(button => {
        button.addEventListener('click', async function() {
            const name = this.getAttribute('data-name');
            await playSoundSegment(name);
            
            // Visual feedback
            this.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.style.transform = '';
            }, 150);
        });
    });
    
    // Add click handler to title to toggle random playback
    const title = document.querySelector('header h1');
    if (title) {
        title.style.cursor = 'pointer';
        title.addEventListener('click', async function() {
            if (isRandomPlaying) {
                // Stop if currently playing
                stopRandomSequence();
            } else {
                // Start random playback
                await playRandomSequence();
            }
        });
    }
});
