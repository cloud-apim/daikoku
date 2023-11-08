import com.typesafe.sbt.packager.docker.{Cmd, ExecCmd}
import com.typesafe.sbt.packager.docker.DockerChmodType
import com.typesafe.sbt.packager.docker.DockerPermissionStrategy

name := """daikoku"""
organization := "fr.maif.otoroshi"
maintainer := "oss@maif.fr"
Universal / packageName := "daikoku"

scalaVersion := "2.13.1"

Global / onChangedBuildSource := ReloadOnSourceChanges

val reactiveMongoVersion = "0.20.10"
val wiremockVersion = "3.0.1"
val playJsonVersion = "2.10.3"
val awsJavaSdkVersion = "1.12.582"

lazy val root = (project in file("."))
  .enablePlugins(PlayScala, DockerPlugin, BuildInfoPlugin, PlayAkkaHttp2Support)
  .disablePlugins(PlayFilters)
  .settings(
    buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion),
    buildInfoPackage := "daikoku"
  )

Test / javaOptions += "-Dconfig.file=conf/application.test.conf"

assembly / assemblyMergeStrategy := {
  case PathList("org", "apache", "commons", "logging", xs @ _*) =>
    MergeStrategy.first
  case PathList(ps @ _*) if ps.contains("module-info.class") =>
    MergeStrategy.first // ???
  case PathList(ps @ _*) if ps.contains("ModuleUtil.class") =>
    MergeStrategy.first // ???
  case PathList(ps @ _*) if ps.contains("reflection-config.json") =>
    MergeStrategy.first // ???
  case PathList(ps @ _*) if ps.contains("mime.types") =>
    MergeStrategy.first //???
  case PathList(ps @ _*) if ps.contains("native-image") =>
    MergeStrategy.first //???
  case "META-INF/mailcap.default"   => MergeStrategy.last
  case "META-INF/mimetypes.default" => MergeStrategy.last
  case x =>
    val oldStrategy = (assembly / assemblyMergeStrategy).value
    oldStrategy(x)
}

libraryDependencies ++= Seq(
  jdbc,
  ws,
  filters,
  "org.scalatestplus.play" %% "scalatestplus-play" % "7.0.0" % Test,
  "com.themillhousegroup" %% "scoup" % "1.0.0" % Test,
  "com.github.tomakehurst" % "wiremock" % wiremockVersion % Test,
  "com.github.tomakehurst" % "wiremock-jre8" % wiremockVersion % Test,
//  "org.testcontainers" % "testcontainers" % "1.17.5" % Test,
  "com.dimafeng" %% "testcontainers-scala-scalatest" % "0.40.14" % Test,
  "com.dimafeng" %% "testcontainers-scala-postgresql" % "0.40.14" % Test,
  "org.apache.commons" % "commons-lang3" % "3.13.0",
  "org.bouncycastle" % "bcprov-jdk18on" % "1.76",
  "com.typesafe.play" %% "play-json" % playJsonVersion,
  "com.typesafe.play" %% "play-json-joda" % playJsonVersion,
  "com.auth0" % "java-jwt" % "4.4.0",
  "com.auth0" % "jwks-rsa" % "0.22.1", // https://github.com/auth0/jwks-rsa-java
  "com.nimbusds" % "nimbus-jose-jwt" % "9.37",
  "com.softwaremill.macwire" %% "macros" % "2.5.9" % "provided",
  "javax.xml.bind" % "jaxb-api" % "2.3.1",
  "com.sun.xml.bind" % "jaxb-core" % "4.0.4",
  "com.sun.xml.bind" % "jaxb-impl" % "4.0.4",
  "io.vertx" % "vertx-pg-client" % "4.4.6",
  "com.ongres.scram" % "common" % "2.1",
  "com.ongres.scram" % "client" % "2.1",
  "io.nayuki" % "qrcodegen" % "1.6.0",
  "com.eatthepath" % "java-otp" % "0.4.0",
  "com.sun.mail" % "jakarta.mail" % "2.0.1",
  "org.gnieh" %% "diffson-play-json" % "4.4.0" excludeAll ExclusionRule(
    organization = "com.typesafe.akka"
  ),
  "com.typesafe.akka" %% "akka-stream-kafka" % "2.0.2",
  "com.typesafe.akka" %% "akka-http-xml" % "10.1.15",
  "org.typelevel" %% "cats-core" % "2.10.0",
  "de.svenkubiak" % "jBCrypt" % "0.4.3",
  "com.lightbend.akka" %% "akka-stream-alpakka-s3" % "2.0.0",
  "com.amazonaws" % "aws-java-sdk-core" % awsJavaSdkVersion,
  "com.amazonaws" % "aws-java-sdk-s3" % awsJavaSdkVersion,
  "com.googlecode.owasp-java-html-sanitizer" % "owasp-java-html-sanitizer" % "20220608.1",
  "commons-logging" % "commons-logging" % "1.2",
  "com.github.jknack" % "handlebars" % "4.3.1",
  "org.sangria-graphql" %% "sangria" % "4.0.2",
  "org.sangria-graphql" %% "sangria-play-json" % "2.0.2" excludeAll ExclusionRule(
    organization = "com.typesafe.play"
  ),
  "com.fasterxml.jackson.module" %% "jackson-module-scala" % "2.15.3",
  "org.apache.logging.log4j" % "log4j-api" % "2.19.0",
  "com.github.blemale" %% "scaffeine" % "5.2.1"
)

dependencyOverrides += "io.netty" % "netty-handler" % "4.1.100.Final"

Test / fork := true

scalacOptions ++= Seq(
  "-feature",
  "-language:higherKinds",
  "-language:implicitConversions",
  "-language:existentials",
  "-language:postfixOps",
//  "-Ypartial-unification",
  "-Xfatal-warnings"
)

resolvers += "bintray" at "https://jcenter.bintray.com"
resolvers += "Millhouse Bintray" at "https://dl.bintray.com/themillhousegroup/maven"

PlayKeys.devSettings := Seq("play.server.http.port" -> "9000")

// sources in (Compile, doc) := Seq.empty
// publishArtifact in (Compile, packageDoc) := false
// scalafmtVersion in ThisBuild := "1.2.0"

/// ASSEMBLY CONFIG

assembly / mainClass := Some("play.core.server.ProdServerStart")
assembly / test := {}
assembly / assemblyJarName := "daikoku.jar"
assembly / fullClasspath += Attributed.blank(PlayKeys.playPackageAssets.value)
assembly / assemblyMergeStrategy := {
  //case PathList("META-INF", xs @ _*) => MergeStrategy.discard
  case PathList("javax", xs @ _*) =>
    MergeStrategy.first
  case PathList("org", "apache", "commons", "logging", xs @ _*) =>
    MergeStrategy.first
  case PathList("org", "apache", "commons", "lang", xs @ _*) =>
    MergeStrategy.first
  case PathList("org", "apache", "commons", "collections", xs @ _*) =>
    MergeStrategy.first
  case PathList(ps @ _*) if ps.last == "io.netty.versions.properties" =>
    MergeStrategy.first
  case PathList(ps @ _*) if ps.contains("reference-overrides.conf") =>
    MergeStrategy.concat
  case PathList(ps @ _*) if ps.last endsWith ".conf" => MergeStrategy.concat
  case PathList(ps @ _*) if ps.contains("buildinfo") =>
    MergeStrategy.discard
  case o =>
    val oldStrategy = (assembly / assemblyMergeStrategy).value
    oldStrategy(o)
}

lazy val packageAll = taskKey[Unit]("PackageAll")
packageAll := {
  (Compile / dist).value
  (Compile / assembly).value
}

/// DOCKER CONFIG

dockerExposedPorts := Seq(
  8080
)
Docker / packageName := "daikoku"
Docker / maintainer := "MAIF OSS Team <oss@maif.fr>"
dockerBaseImage := "eclipse-temurin:11.0.13_8-jre-focal"
dockerUsername := Some("maif")
dockerUpdateLatest := true
dockerCommands := dockerCommands.value.filterNot {
  case ExecCmd("CMD", args @ _*) => true
  case cmd                       => false
}
Docker / dockerPackageMappings += (baseDirectory.value / "docker" / "start.sh") -> "/opt/docker/bin/start.sh"
dockerEntrypoint := Seq("/opt/docker/bin/start.sh")
dockerUpdateLatest := true

// swaggerDomainNameSpaces := Seq("fr.maif.otoroshi.daikoku.domain")
// swaggerV3 := true
// swaggerPrettyJson := true

import sbtrelease.ReleasePlugin.autoImport.ReleaseTransformations._

releaseProcess := Seq[ReleaseStep](
  checkSnapshotDependencies, // : ReleaseStep
  inquireVersions, // : ReleaseStep
  runClean, // : ReleaseStep
  // runTest,                                // : ReleaseStep
  setReleaseVersion, // : ReleaseStep
  commitReleaseVersion, // : ReleaseStep, performs the initial git checks
  tagRelease, // : ReleaseStep
  // publishArtifacts,                       // : ReleaseStep, checks whether `publishTo` is properly set up
  setNextVersion, // : ReleaseStep
  commitNextVersion, // : ReleaseStep
  pushChanges // : ReleaseStep, also checks that an upstream branch is properly configured
)
