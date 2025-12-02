# Deskulpt Widgets Registry

This is the central registry for [Deskulpt](https://deskulpt-apps.github.io/) widgets.

## For Users

You need to install [Deskulpt](https://github.com/deskulpt-apps/Deskulpt/releases/latest) first to use the widgets. Then you can open the Deskulpt manager interface and go to the "Gallery" tab, where you can browse and install widgets from this registry.

🚧 An online version of the widget gallery is under construction. 🚧

## For Widget Developers

🚧 The widget development and publishing guide is under construction. 🚧

## For Deskulpt Maintainers

The registry index is accessible from [jsdelivr](https://www.jsdelivr.com/) at https://cdn.jsdelivr.net/gh/deskulpt-apps/widgets@registry/index.json. It is incrementally generated from pushes to the main branch. Note that jsdelivr can cache for up to 7 days. In case of urgent updates that need to be reflected immediately, use its [purge tool](https://www.jsdelivr.com/tools/purge) with the URL above.

The widgets are hosted via [GitHub Container Registry (GHCR)](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) and can be found at https://github.com/orgs/deskulpt-apps/packages?repo_name=widgets. [ORAS](https://oras.land/) is used to package, push, and pull the widgets as [OCI](https://opencontainers.org/) artifacts to/from GHCR.
