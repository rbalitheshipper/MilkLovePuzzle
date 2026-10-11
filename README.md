# Jigsaw Puzzle

A browser-based jigsaw game built with HTML, CSS, Canvas, and vanilla JavaScript.

## Run it
Open `index.html` in a modern browser, or serve the folder with VS Code's Live Server.

## Pictures
Put your 4:3 photos in `images/`, then list them at the top of `game.js`:

```js
const PICTURES = [
  { name: "Picture 1", src: "images/picture1.jpg" },
  { name: "Picture 2", src: "images/picture2.jpg" }
];
```

The dropdown is built from this list. Photos that are not exactly 4:3 are centre-cropped.

## How it plays
1. Pick a picture and difficulty. The finished picture is shown once.
2. Press **Start puzzle and timer**. The picture disappears and the timer starts.
3. Drag pieces onto the empty grid. Pieces snap and lock when close to their spot.
4. The timer stops on the last piece. Best time is saved per picture and difficulty (localStorage).

## Files
- `index.html` — interface
- `style.css` — styling
- `game.js` — piece cutting, drag-and-drop, snapping, timer, best times
