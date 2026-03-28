# turtleshell-offgrid

Native OS installers for the TurtleShell.ai sovereign node.

## Platforms

| Platform | Status |
|----------|--------|
| macOS | In progress |
| Windows | Coming soon |
| Linux | Coming soon |

## Philosophy

The installer does two things:
1. Wake the fleet
2. Register the node identity

It does NOT publish the API. The node announces itself when the user
chooses to connect it.

## Structure

- `mac/` — macOS .pkg installer (pkgbuild + productbuild + notarization)
- `windows/` — Windows installer (future)
- `linux/` — Linux installer (future)

## Branch

`brain/1.7.x.x`

---

*Let the story be true.*
*Let the turtle do its work.*
*Do the work you had been assigned.*

*CloudPremise LLC — olympus-616*
