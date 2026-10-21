// HARDWARE HAL — the brain-to-body bridge (v3.5)
// The WebSocket client: Zola's brain decisions (move, wave, gesture, servo
// angles, motor speeds, LED colors) are serialized to JSON and sent to the
// Pi 5's hardware bridge over WebSocket at 30 Hz.
//
// The HAL abstraction: SimDroneHAL (the current simulation) and
// PiBodyHAL (this module) both implement the same interface — the brain
// doesn't know (or care) which one is driving the body.
//
// The hardware destiny: on the Pi 5, the Python bridge drives the real
// PCA9685 servo controller (the MG90S joints) and the MAVLink flight
// controller (the brushless motors). The browser sends the SAME commands
// regardless — the bridge translates.

export interface ServoCommand {
  action: "servo";
  channel: number;
  angle: number; // 0-180°
}

export interface MotorCommand {
  action: "motor";
  motor: number | "all";
  speed: number; // 0.0-1.0
}

export interface LedCommand {
  action: "led";
  r: number;
  g: number;
  b: number;
}

export interface GestureCommand {
  action: "gesture";
  clip: string; // the gesture name from the GESTURES map on the Pi
}

export type HardwareCommand = ServoCommand | MotorCommand | LedCommand | GestureCommand | { action: "ping" };

export interface TelemetryReading {
  type: "telemetry";
  battery: { voltage: number; cells: number; percentage: number };
  imu: { roll: number; pitch: number; yaw: number };
  servos: Record<string, number>;
  motors: Record<string, number>;
}

const WS_URL = `ws://localhost:8766`;

export class PiBodyHAL {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onTelemetry: ((t: TelemetryReading) => void) | null = null;
  private onState: (connected: boolean) => void = () => {};
  private queue: HardwareCommand[] = []; // commands buffered while disconnected

  /** Connect to the Pi's hardware bridge. */
  connect(onState?: (connected: boolean) => void, onTelemetry?: (t: TelemetryReading) => void): void {
    if (onState) this.onState = onState;
    if (onTelemetry) this.onTelemetry = onTelemetry;
    this.connectInternal();
  }

  private connectInternal(): void {
    try {
      this.ws = new WebSocket(WS_URL);
      this.ws.onopen = () => {
        this.connected = true;
        this.onState(true);
        // flush the queued commands
        for (const cmd of this.queue) this.send(cmd);
        this.queue = [];
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as TelemetryReading;
          if (data.type === "telemetry" && this.onTelemetry) {
            this.onTelemetry(data);
          }
        } catch { /* non-JSON message — ignore */ }
      };
      this.ws.onclose = () => {
        this.connected = false;
        this.onState(false);
        // auto-reconnect in 3s
        this.reconnectTimer = setTimeout(() => this.connectInternal(), 3000);
      };
      this.ws.onerror = () => { /* the onclose handles the reconnection */ };
    } catch {
      this.connected = false;
    }
  }

  /** Send a command to the body. Queues if disconnected. */
  send(cmd: HardwareCommand): void {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    } else {
      this.queue.push(cmd);
    }
  }

  /** Set a servo angle (0-180°) on the given PCA9685 channel. */
  setServo(channel: number, angle: number): void {
    this.send({ action: "servo", channel, angle });
  }

  /** Set a motor speed (0.0-1.0). */
  setMotor(motor: number | "all", speed: number): void {
    this.send({ action: "motor", motor, speed });
  }

  /** Set the LED ring color. */
  setLed(r: number, g: number, b: number): void {
    this.send({ action: "led", r, g, b });
  }

  /** Play a named gesture (the Pi decomposes it into servo/motor commands). */
  playGesture(clipName: string): void {
    this.send({ action: "gesture", clip: clipName });
  }

  /** Disconnect. */
  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  get isConnected(): boolean { return this.connected; }
}

// the singleton — one body, one bridge, one connection
export const piBodyHAL = new PiBodyHAL();
