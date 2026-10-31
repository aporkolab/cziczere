FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
COPY src/main src/main
RUN mvn -B -ntp compile org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy-dependencies -DincludeScope=runtime \
    && mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy \
        -Dartifact=com.google.cloud.functions.invoker:java-function-invoker:2.0.2 -DoutputDirectory=target/invoker

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /build/target/invoker/java-function-invoker-2.0.2.jar invoker.jar
COPY --from=build /build/target/classes classes
COPY --from=build /build/target/dependency lib
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "invoker.jar", "--target", "com.cziczere.functions.LocalApi", "--classpath", "classes:lib/*", "--port", "8080"]
