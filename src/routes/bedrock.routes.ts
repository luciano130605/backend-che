import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import {
  confirmInterpretation,
  previewInterpretation,
  removeUnparsed,
  retry,
  saveAsTask,
  unparsed,
} from "../controllers/bedrock.controller";

export const bedrockRouter = Router();

bedrockRouter.use(requireAuth);
bedrockRouter.post("/parse", previewInterpretation);
bedrockRouter.post("/confirm", confirmInterpretation);
bedrockRouter.get("/unparsed", unparsed);
bedrockRouter.post("/unparsed/:id/retry", retry);
bedrockRouter.post("/unparsed/:id/save", saveAsTask);
bedrockRouter.delete("/unparsed/:id", removeUnparsed);
