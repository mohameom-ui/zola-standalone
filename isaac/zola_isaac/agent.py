"""PPO settings for initial balance and flat-ground motion experiments."""
from isaaclab.utils import configclass
from isaaclab_rl.rsl_rl import RslRlMLPModelCfg, RslRlOnPolicyRunnerCfg, RslRlPpoAlgorithmCfg


@configclass
class ZolaPPORunnerCfg(RslRlOnPolicyRunnerCfg):
    num_steps_per_env = 24
    max_iterations = 1500
    save_interval = 50
    experiment_name = "zola_prototype"
    obs_groups = {"actor": ["policy"], "critic": ["policy"]}
    clip_actions = 1.0
    actor = RslRlMLPModelCfg(
        hidden_dims=[128, 128], activation="elu", obs_normalization=True,
        distribution_cfg=RslRlMLPModelCfg.GaussianDistributionCfg(init_std=.3),
    )
    critic = RslRlMLPModelCfg(hidden_dims=[128, 128], activation="elu", obs_normalization=True)
    algorithm = RslRlPpoAlgorithmCfg(
        value_loss_coef=1.0, use_clipped_value_loss=True, clip_param=.2,
        entropy_coef=.005, num_learning_epochs=5, num_mini_batches=4,
        learning_rate=3e-4, schedule="adaptive", gamma=.99, lam=.95,
        desired_kl=.01, max_grad_norm=1.0,
    )


@configclass
class ZolaBalancePPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_balance_prototype"


@configclass
class ZolaWalkPPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_walk_prototype"


@configclass
class ZolaHandsPPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_hands_prototype"
    max_iterations = 1500


@configclass
class ZolaFlightPPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_flight_posture"
    max_iterations = 1500


@configclass
class ZolaHoverPPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_hover"
    max_iterations = 1500


@configclass
class ZolaTakeoffPPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_takeoff"
    max_iterations = 1500


@configclass
class ZolaSitPPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_sit"
    max_iterations = 1200


@configclass
class ZolaPicturePPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_picture"
    max_iterations = 1200


@configclass
class ZolaThumbsPPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_thumbs"
    max_iterations = 1200


@configclass
class ZolaDancePPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_dance"
    max_iterations = 2000


@configclass
class ZolaTouchdownPPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_touchdown"
    max_iterations = 1500
