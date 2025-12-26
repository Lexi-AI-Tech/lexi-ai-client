/**
 * Application Entry Point
 *
 * This is the main entry point for the React frontend application.
 * It initializes React and renders the root App component into the DOM.
 *
 * React.StrictMode is enabled to help identify potential problems during
 * development (it doesn't affect production builds).
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Get the root DOM element and render the App component
// The ! operator asserts that the element exists (it should, as it's in index.html)
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
