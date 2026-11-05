"""PPO settings for initial balance and flat-ground motion experiments."""
from isaaclab.utils import configclass
from isaaclab_rl.rsl_rl import RslRlMLPModelCfg, RslRlOnPolicyRunnerCfg, RslRlPpoAlgorithmCfg


@configclass
class ZolaPPORunnerCfg(RslRlOnPolicyRunnerCfg):
    # THE OPTIMIZER CONTRACT (documented 2026-11-05 — the four knobs the user
    # named, with what this stack honestly exposes):
    #   LEARNING RATE — 3e-4 → 1e-3 below. schedule="adaptive" still governs:
    #   the KL controller raises/lowers the live LR every update, so the
    #   initial value sets the starting aggressiveness, desired_kl (.01) sets
    #   the ceiling on policy change per update.
    #   MOMENTUM — Adam's β₁=0.9, β₂=0.999 (torch defaults). RslRlPpoAlgorithmCfg
    #   does NOT expose betas (its optimizer field is a NAME string: adam/adamw/
    #   sgd/rmsprop — resolve_optimizer builds the class with lr only), so the
    #   momentum is documented here, not tuned. β₁=0.9 IS the momentum term.
    #   BIAS INPUT — three real bias layers, all active: (1) every Linear
    #   layer's bias vector (PyTorch default init), (2) the observation
    #   normalizer's mean/std offset (obs_normalization=True — the input
    #   bias), (3) init_noise_std=.3 — the exploration bias: how far the
    #   policy's first actions sample from its own mean.
    #   ACTIVATION — ELU is the canon (11 shelf policies trained on it). The
    #   sigmoid A/B (ZolaTouchdownSigmoidPPORunnerCfg) tests the user's
    #   sigmoid request with ONE variable; the verdict decides the base.
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
        learning_rate=1e-3, schedule="adaptive", gamma=.99, lam=.95,
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
class ZolaTalkPPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_talk"
    max_iterations = 1500


@configclass
class ZolaTouchdownPPORunnerCfg(ZolaPPORunnerCfg):
    experiment_name = "zola_touchdown"
    max_iterations = 1500


@configclass
class ZolaTouchdownSigmoidPPORunnerCfg(ZolaPPORunnerCfg):
    """THE SIGMOID A/B — one variable: the activation. Everything else is the
    touchdown runner byte-for-byte, INCLUDING the old lr 3e-4 (pinned so the
    referee is clean: touchdown_v10, ELU, 533/600). Sigmoid saturates at 0/1
    and its gradients vanish in the tails — the standard prediction is that
    it loses; the training record decides, not the prediction."""
    experiment_name = "zola_touchdown_sigmoid"
    max_iterations = 1500
    algorithm = RslRlPpoAlgorithmCfg(
        value_loss_coef=1.0, use_clipped_value_loss=True, clip_param=.2,
        entropy_coef=.005, num_learning_epochs=5, num_mini_batches=4,
        learning_rate=3e-4, schedule="adaptive", gamma=.99, lam=.95,
        desired_kl=.01, max_grad_norm=1.0,
    )
    actor = RslRlMLPModelCfg(
        hidden_dims=[128, 128], activation="sigmoid", obs_normalization=True,
        distribution_cfg=RslRlMLPModelCfg.GaussianDistributionCfg(init_std=.3),
    )
    critic = RslRlMLPModelCfg(hidden_dims=[128, 128], activation="sigmoid", obs_normalization=True)
