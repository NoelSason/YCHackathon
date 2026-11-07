# Official editor skill

This skill uses the official [Geometry Dash Editor Guide](https://www.robtopgames.com/files/GDEditor.pdf)
and the Mobilerun Agent MCP tool, when attached to the agent, to author a local draft on a
user-authorized mobile device. It does not require BetterEdit.

The official guide describes local editor levels and Save / Save and Play actions. Mobilerun's
[Cloud Quickstart](https://docs.mobilerun.ai/cloud/quickstart) describes tasks on an existing ready
device, with status and trajectory results. This skill does not provision or reset devices and
does not upload or publish levels.

Remote mobile interaction can check editor navigation, save state, and visual loading. It cannot
substitute for a headless solver or prove frame-accurate completion. Keep the rhythm-runner adapter
and solver as the source of truth for our product.
