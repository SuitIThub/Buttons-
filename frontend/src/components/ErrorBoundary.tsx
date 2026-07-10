import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Fängt Render-Fehler ab und zeigt eine lesbare Meldung statt eines weißen
 * Bildschirms. Wichtig, weil reale Gerätedaten unerwartete Formen haben können.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI-Fehler:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl p-6">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5">
            <h1 className="mb-2 text-lg font-semibold text-red-300">Es ist ein Fehler aufgetreten</h1>
            <p className="mb-3 text-sm text-slate-300">
              Die Oberfläche konnte nicht dargestellt werden. Details:
            </p>
            <pre className="mb-4 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-red-200">
              {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack}
            </pre>
            <button
              onClick={this.reset}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Erneut versuchen
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
