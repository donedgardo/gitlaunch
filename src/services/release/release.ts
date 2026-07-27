// A Release is the unit GitLaunch delivers. It is immutable: once cut, its
// version and artifact set never change, so an agent reconciling "prod wants
// 1.4.2" always resolves to the same bytes no matter when it asks.
//
// Artifacts are provider-agnostic references, not rendered manifests. A Helm
// target reads the helm-chart artifact, a cloud target reads the
// terraform-module artifact, and both read container-image digests. Rendering
// is the delivery adapter's job, so the same Release can land on a managed
// cluster, a bare-metal k3s box, or a cloud account.

// Pinned by digest, not tag — tags are mutable, and an edge fleet reconciling a
// week-late release must get the image the release was cut from.
export type ContainerImageArtifact = {
  kind: "container-image";
  repository: string;
  digest: string;
  // Human-facing only (dashboards, logs). Never used to resolve the image.
  tag?: string;
};

export type HelmChartArtifact = {
  kind: "helm-chart";
  repository: string;
  chart: string;
  version: string;
};

export type TerraformModuleArtifact = {
  kind: "terraform-module";
  source: string;
  version: string;
};

export type ReleaseArtifact =
  | ContainerImageArtifact
  | HelmChartArtifact
  | TerraformModuleArtifact;

// The parts of a Release the promotion core needs. Persistence adds identity
// and provenance on top of this (see ReleaseRepository).
export type ReleaseContents = {
  version: string;
  artifacts: ReleaseArtifact[];
};
