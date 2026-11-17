# Sample images

Photos in this folder are downloaded by `npm run samples` from
[picsum.photos](https://picsum.photos), which serves images from Unsplash under the
[Unsplash License](https://unsplash.com/license) (free to use, no attribution required).

File names (`picsum-<id>.jpg`) record the source ID, so `https://picsum.photos/id/<id>/info`
shows the original photographer and Unsplash URL.

They are used for:
- the demo page (registered "originals"),
- automated tests (`backend/tests`),
- threshold calibration (`npm run evaluate`).

The set deliberately includes several visually similar landscape/sea photos to measure
"similar but unrelated" false positives.
