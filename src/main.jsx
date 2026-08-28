import React from "react";
import ReactDOM from "react-dom/client";
import CageLab from "./App.jsx";
import "./index.css";

class Catch extends React.Component {
  constructor(p) { super(p); this.state = { err: null, info: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    this.setState({ info });
    console.error("RENDER CRASH:", err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <pre style={{ padding: 20, whiteSpace: "pre-wrap", color: "#b00", fontSize: 13 }}>
          {String(this.state.err && this.state.err.stack || this.state.err)}
          {"\n\n--- COMPONENT STACK ---\n"}
          {this.state.info && this.state.info.componentStack}
        </pre>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <Catch><CageLab /></Catch>
);