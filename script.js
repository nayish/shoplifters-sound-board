// Sound board functionality
let soundsData = {};
let audioContext = null;
let bufferCache = {}; // Cache AudioBuffers by filename
let currentSource = null; // Current AudioBufferSourceNode
let playRequestId = 0; // Track latest play request to ignore stale async operations
let selectedSong = 'all'; // Currently selected song filter

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
    };
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

// Filter buttons and sections based on selected song
function filterButtonsBySong(song) {
    selectedSong = song;
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
    await loadSoundsConfig();
    
    // Populate song picker
    populateSongPicker();
    
    // Handle main song picker change
    const mainPicker = document.getElementById('song-picker');
    mainPicker.addEventListener('change', function() {
        filterButtonsBySong(this.value);
    });
    
    const buttons = document.querySelectorAll('.sound-button');
    let preloaded = false;
    
    buttons.forEach(button => {
        button.addEventListener('click', async function() {
            // Initialize audio context on first click (user interaction required)
            const context = initAudioContext();
            if (context && context.state === 'suspended') {
                await context.resume();
            }
            
            // Preload on first click if not already done
            if (!preloaded) {
                await preloadAudio();
                preloaded = true;
            }
            
            const name = this.getAttribute('data-name');
            await playSoundSegment(name);
            
            // Visual feedback
            this.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.style.transform = '';
            }, 150);
        });
    });
});
