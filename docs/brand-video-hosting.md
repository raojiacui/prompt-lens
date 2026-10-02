# Brand Film Hosting

The landing navigation opens the existing guide at `/guide` and the final brand film in a native modal video player.

For local preview, the final v12 MP4 is copied to `public/brand-video/prompt-lens-final.mp4`. This directory is intentionally ignored by Git: promotional media should not enter the open-source repository.

Before production deployment, upload the final MP4 to public media hosting and set `NEXT_PUBLIC_BRAND_VIDEO_URL` to its HTTPS URL in the build environment. This is a public media URL, not a storage credential. The host should serve `video/mp4` and support byte-range requests. Rebuild after changing this variable.

Without that variable, the player uses the local path. A clean Git checkout does not include the film. Verify playback after deployment; do not treat a local playback check as production media acceptance.
