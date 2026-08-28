import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error("CageLab render error:", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const isDev =
      typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;

    return (
      <div className="crash-panel" role="alert">
        <div className="crash-title">Something broke.</div>
        <p className="crash-body">
          CageLab hit an error while rendering. Your saved builds and career
          history are stored locally and haven&apos;t been touched.
        </p>
        <button className="btn btn-primary" onClick={this.handleReload}>
          Reload CageLab
        </button>

        <details className="crash-details" open={!!isDev}>
          <summary>Technical details</summary>
          <pre>
            {String((error && error.stack) || error)}
            {info && info.componentStack
              ? `\n\n--- COMPONENT STACK ---${info.componentStack}`
              : ""}
          </pre>
        </details>
      </div>
    );
  }
}