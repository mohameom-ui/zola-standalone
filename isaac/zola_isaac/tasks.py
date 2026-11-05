"""Gym registrations discovered by Isaac Lab 3's isaaclab.tasks entry point."""
import gymnasium as gym

for task, config in (("Balance", "ZolaBalanceCfg"), ("Walk", "ZolaWalkCfg"), ("Hands", "ZolaHandsCfg"),
                      ("Flight", "ZolaFlightCfg"), ("Hover", "ZolaHoverCfg"), ("Takeoff", "ZolaTakeoffCfg"),
                      ("Sit", "ZolaSitCfg"), ("Picture", "ZolaPictureCfg"), ("Thumbs", "ZolaThumbsCfg"),
                      ("Dance", "ZolaDanceCfg"), ("Talk", "ZolaTalkCfg"), ("Touchdown", "ZolaTouchdownCfg"),
                      ("TouchdownSigmoid", "ZolaTouchdownSigmoidCfg")):
    gym.register(
        id=f"Isaac-Zola-{task}-Prototype-v0",
        entry_point="zola_isaac.env:ZolaPrototypeEnv",
        disable_env_checker=True,
        kwargs={
            "env_cfg_entry_point": f"zola_isaac.env_cfg:{config}",
            "rsl_rl_cfg_entry_point": f"zola_isaac.agent:Zola{task}PPORunnerCfg",
            "default_agent": "rsl_rl",
        },
    )
