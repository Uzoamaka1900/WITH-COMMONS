// models/Contribution.js
const mongoose = require("mongoose");

const contributionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    type: { type: String, required: true },
    collection: { type: String, required: true },
    tags: [{ type: String }],
    contributorName: { type: String, required: true },
    contributorEmail: { type: String, required: true },
    status: { type: String, default: "Pending" },
    fileName: String,
    filePath: String,
    fileMimeType: String,
    fileSize: Number
  },
  { timestamps: true }
);

module.exports = mongoose.model("Contribution", contributionSchema);
