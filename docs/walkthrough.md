# Verification Walkthrough
## Objective
Verify that the "Refine" button behaves correctly when the 10 million face limit is reached and resets appropriately when a new file is loaded.

## Steps
1. **Load a Model**
   - Click "Load STL" and select a mesh file.

2. **Select Faces**
   - Use the mouse to select a portion of the mesh (or click "Select Entire STL").

3. **Hit the Limit**
   - Click "Refine Selection".
   - Repeat this process. The face count increases with each click.
   - Continue until the total or projected face count exceeds 10,000,000.
   - **Expectation:** 
     - A warning "Limit > 10M Faces!" appears.
     - The "Refine Selection" button turns **GRAY** and becomes unclickable.
     - The "Processing" animation (orange stripes) stops.

4. **Verify Persistence**
   - Try to click the "Refine" button again.
   - **Expectation:** It should remain disabled.

5. **Reset State**
   - Click "Load STL" again and load a new file (or the same one).
   - **Expectation:**
     - The warning message disappears.
     - The "Refine Selection" button becomes blue/active again.

## Troubleshooting
- If the button stays stuck in "Refining..." (orange stripes) for more than 5 seconds without action, the safety timeout will auto-reset it.
- If the button does not disable at 10M, ensure you are selecting enough faces to push the count over the limit.
