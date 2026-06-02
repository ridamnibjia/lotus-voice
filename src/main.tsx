import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./client";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);