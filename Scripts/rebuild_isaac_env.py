# rebuild_isaac_env.py — ONE COMMAND to rebuild the Isaac training environment
#   python Scripts/rebuild_isaac_env.py
#
# The isaac-venv lived in the scratchpad (ephemeral) and vanished between
# sessions. This script rebuilds it at a PERSISTENT path (inside the repo's
# .venv-isaac, gitignored) so the training environment survives restarts.
#
# Installs: isaaclab[isaacsim,rsl-rl]==3.0.0 · mujoco (the physics twin)
#           · tensorboard (the live curves) · onnx + onnxruntime (the exports)
# Time: ~20 minutes (the isaaclab wheel is ~2 GB).
import subprocess, sys, os

VENV = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".venv-isaac"))
IS_WIN = sys.platform == "win32"
PY = os.path.join(VENV, "Scripts", "python.exe") if IS_WIN else os.path.join(VENV, "bin", "python")

def log(m): print(f"[rebuild] {m}", flush=True)

def run(cmd):
    log(f"> {cmd}")
    r = subprocess.run(cmd, shell=(IS_WIN), capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:] if r.stdout else "", flush=True)
        print(r.stderr[-2000:] if r.stderr else "", flush=True)
        raise SystemExit(f"FAILED: {cmd}")
    return r

if not os.path.exists(PY):
    log(f"creating venv at {VENV}")
    run(f'"{sys.executable}" -m venv "{VENV}"')

log("upgrading pip")
run(f'"{PY}" -m pip install --quiet --upgrade pip')

log("installing mujoco + tensorboard + onnx (lightweight, the physics twin + curves + exports)")
run(f'"{PY}" -m pip install --quiet mujoco tensorboard onnx onnxruntime')

log("installing isaaclab[isaacsim,rsl-rl]==3.0.0 (~2 GB — this takes a while)")
run(f'"{PY}" -m pip install --quiet "isaaclab[isaacsim,rsl-rl]==3.0.0" '
    '--extra-index-url https://pypi.nvidia.com '
    '--index-strategy unsafe-best-match')

log("installing the Zola physics package")
run(f'"{PY}" -m pip install --no-deps -e "{os.path.join(os.path.dirname(__file__), "..", "isaac")}"')

log("installing usd-core (the USD validation)")
run(f'"{PY}" -m pip install --quiet usd-core')

log("installing moviepy + imageio-ffmpeg (the video recording)")
run(f'"{PY}" -m pip install --quiet "moviepy>=1.0.3,<2.0.0.dev0" imageio-ffmpeg')

log("DONE — the Isaac training environment is at .venv-isaac/")
log("usage:")
print(f"  {PY} Scripts/pose_physics_check.py")
print(f"  {VENV}{os.sep}Scripts{os.sep}isaaclab.exe train --rl_library rsl_rl --task Isaac-Zola-Hover-Prototype-v0 --num_envs 64")
print(f"  ZOLA_VENV=\"{VENV}/Scripts\" node Scripts/isaac-continuous.mjs")
