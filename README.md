# Vite React Express WebSockets Game

A mobile-first real-time multiplayer game built with modern web technologies and deployed on Railway.

## 🎮 Live Demo

**Play the game**: https://soothing-possibility-production.up.railway.app
**Server API**: https://calm-simplicity-production.up.railway.app

## 🚀 Overview

This project is a mobile-first multiplayer real-time game that runs in web browsers. Players can join the game, move around on a responsive grid-based map using touch controls or click, and interact with other players in real-time.

## ✨ Features

- **📱 Mobile-First Design** - Golden ratio responsive canvas (61.803% of viewport)
- **🎮 Nintendo-Style D-Pad** - Touch-friendly controls with Lucide icons
- **⚡ Real-time Multiplayer** - Socket.IO powered instant communication
- **🎯 Responsive Grid** - Exactly 24x24 cells that scale perfectly
- **🎨 Hyper-Minimal UI** - Clean 1px grid lines, no visual clutter
- **💾 Smart Persistence** - Efficient auto-save (every 5 minutes)
- **🌐 Cross-Platform** - Works on desktop, mobile, and tablets
- **☁️ Cloud Deployed** - Live on Railway with proper CORS

## 🛠 Tech Stack

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web application framework  
- **Socket.IO** - Real-time bidirectional communication
- **Railway** - Cloud deployment platform
- **JSON storage** - Lightweight persistent data

### Frontend
- **React** - User interface library
- **Vite** - Lightning-fast build tool
- **HTML5 Canvas** - High-performance game rendering
- **Lucide React** - Beautiful icon library
- **Socket.IO Client** - Real-time server communication
- **CSS Grid & Flexbox** - Responsive layout system

## 📁 Project Structure

```
vite-react-express-websockets/
├── client/                    # React frontend application
│   ├── src/
│   │   ├── App.jsx           # Main app with socket management
│   │   ├── GameCanvas.jsx    # Responsive canvas & game logic
│   │   ├── DPad.jsx          # Touch-friendly d-pad component
│   │   ├── main.jsx          # Application entry point
│   │   └── index.css         # Mobile-first responsive styles
│   ├── public/               # Static assets
│   ├── package.json          # Frontend dependencies
│   ├── vite.config.js        # Vite configuration with Railway support
│   └── railway.toml          # Railway deployment config
├── server/                    # Node.js backend application
│   ├── index.js              # Server with Socket.IO and game logic
│   ├── database.json         # Player data storage (gitignored)
│   ├── package.json          # Backend dependencies
│   └── railway.toml          # Railway deployment config
├── .gitignore                # Git ignore rules
└── README.md                 # This file
```

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm (v9 or higher)

### Local Development

1. **Clone the repository:**
```bash
git clone https://github.com/compusophy/vite-react-express-websockets.git
cd vite-react-express-websockets
```

2. **Install server dependencies:**
```bash
cd server
npm install
```

3. **Install client dependencies:**
```bash
cd ../client
npm install
```

4. **Start the server:**
```bash
cd server
npm start
```
Server runs on http://localhost:3000

5. **Start the client (new terminal):**
```bash
cd client
npm run dev
```
Client runs on http://localhost:5173

6. **Play the game!**
Open http://localhost:5173 in your browser

## 🎮 Game Controls

### Desktop
- **Click** anywhere on the canvas to move your player
- **D-Pad** buttons for precise movement

### Mobile/Touch
- **Tap** anywhere on the canvas to move
- **Touch** the D-pad for directional movement
- Optimized for one-handed play

### Visual Feedback
- **Your player**: Highlighted with a thin golden ring
- **Other players**: Colored circles without rings
- **Grid**: Hyper-minimal 1px lines for clarity

## ⚙️ Key Technical Features

### Responsive Design
- **Golden Ratio Canvas**: 61.803% of smaller viewport dimension on desktop
- **Full Width Mobile**: Edge-to-edge square canvas on mobile devices
- **Dynamic D-Pad**: Scales proportionally to canvas size
- **Touch Optimization**: `touch-action: manipulation` for crisp interactions

### Real-time Architecture
- **Socket.IO**: Bidirectional real-time communication
- **Immediate Updates**: Local state updates + server sync
- **CORS Configuration**: Properly configured for Railway domains
- **Connection Management**: Automatic reconnection handling

### Performance Optimizations
- **Smart Auto-Save**: 5-minute intervals (not 30 seconds!)
- **Canvas Rendering**: Efficient drawing with minimal redraws
- **Mobile Performance**: Optimized touch handling
- **Build Optimization**: Vite's optimized production builds

## 🌐 Deployment (Railway)

This project is configured for Railway deployment with separate services:

### Server Deployment
```bash
cd server
railway login
railway link [your-project]
railway up
```

### Client Deployment
```bash
cd client
railway add  # Creates new service
railway up
```

### Environment Configuration
- Server binds to `0.0.0.0:$PORT`
- Client uses production server URL automatically
- CORS configured for Railway domains
- Vite preview configured for Railway healthchecks

## 🔧 Customization

### Canvas & Grid
```javascript
// client/src/GameCanvas.jsx
const GRID_COLS = 24  // Grid width
const GRID_ROWS = 24  // Grid height

// Golden ratio calculation
const canvasDimension = Math.floor(minDimension * 0.61803)
```

### D-Pad Styling
```css
/* client/src/index.css */
.dpad-button {
  /* Customize D-pad appearance */
}
```

### Player Colors
```javascript
// server/index.js
const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', /* add more colors */];
```

### Auto-Save Frequency
```javascript
// server/index.js
const SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- Built with modern web technologies
- Deployed on Railway cloud platform
- Icons by Lucide React
- Inspired by classic mobile gaming UX