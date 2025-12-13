#!/bin/bash

echo "🚀 Building Lexi AI..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing Node.js dependencies..."
    npm install
fi


# Build the Tauri app
echo "🔨 Building Tauri application..."
npm run build

echo "✅ Build complete!"
echo ""
echo "To run the app in development mode:"
echo "  npm run dev"
echo ""
echo "To build for production:"
echo "  npm run build"
