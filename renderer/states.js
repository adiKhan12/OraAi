// OraAI State Machine
const OrbState = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  GUIDING: 'guiding',
});

class StateMachine {
  constructor() {
    this.state = OrbState.IDLE;
    this.listeners = [];
    this.stateStartTime = Date.now();
  }

  transition(newState) {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.stateStartTime = Date.now();
    this.listeners.forEach((fn) => fn(newState, oldState));
  }

  onTransition(fn) {
    this.listeners.push(fn);
  }

  elapsed() {
    return (Date.now() - this.stateStartTime) / 1000;
  }
}
