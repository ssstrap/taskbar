/**
 * Точка входа приложения.
 * Монтирует корневой компонент App в DOM-элемент #root.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
