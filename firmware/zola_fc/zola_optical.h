// zola_optical.h — THE VISION POSITION STACK (module interface)
// PMW3901 optical flow (SPI) + VL53L1X ToF height (I2C) → GPS-denied
// station keeping: the flow's angular rate × the ToF's height = real
// velocity (the pinhole model), fused with the IMU's acceleration.
#pragma once
#include <Arduino.h>

namespace zola_optical {

bool init();          // both sensors; each failure degrades gracefully
void poll(float ax_mps2, float ay_mps2, float dt);  // the flight loop calls

// the fused velocity (m/s, body frame) — accel-integrated in the short
// term, the optical flow's velocity correcting it in the long term
float velocity_x();
float velocity_y();

// the integrated position (m, relative to the station-keeping origin)
float position_x();
float position_y();

void capture_home();  // at mode entry: hold HERE

// the angle setpoints the cascade should hold (degrees) — 0,0 when the
// vision stack isn't healthy enough to trust
void position_hold_angles(float& roll_deg, float& pitch_deg);

// diagnostics: flow quality (the shutter's illumination verdict) + ToF agl
bool flow_healthy();
bool tof_healthy();
float height_agl_m();

}  // namespace zola_optical
